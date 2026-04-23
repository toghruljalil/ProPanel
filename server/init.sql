CREATE TABLE IF NOT EXISTS roles (
    name VARCHAR(50) PRIMARY KEY,
    parent_role VARCHAR(50) REFERENCES roles(name),
    view_projects BOOLEAN DEFAULT FALSE,
    create_project BOOLEAN DEFAULT FALSE,
    edit_project BOOLEAN DEFAULT FALSE,
    delete_project BOOLEAN DEFAULT FALSE,
    manage_users BOOLEAN DEFAULT FALSE,
    view_reports BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    role VARCHAR(50) REFERENCES roles(name),
    status VARCHAR(50) NOT NULL,
    password VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS activities (
    id SERIAL PRIMARY KEY,
    user_name VARCHAR(255) NOT NULL,
    action_html TEXT NOT NULL,
    color VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    "desc" TEXT,
    status VARCHAR(50) NOT NULL,
    progress INTEGER DEFAULT 0,
    owner VARCHAR(255) NOT NULL,
    date VARCHAR(100) NOT NULL
);

-- Insert default roles if table is empty
INSERT INTO roles (name, parent_role, view_projects, create_project, edit_project, delete_project, manage_users, view_reports)
SELECT * FROM (VALUES
    ('viewer', NULL, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE),
    ('editor', 'viewer', FALSE, TRUE, TRUE, FALSE, FALSE, FALSE),
    ('admin', 'editor', FALSE, FALSE, FALSE, TRUE, TRUE, TRUE)
) AS v(name, parent_role, view_projects, create_project, edit_project, delete_project, manage_users, view_reports)
WHERE NOT EXISTS (SELECT 1 FROM roles);

-- Insert default users if table is empty
INSERT INTO users (name, email, role, status, password)
SELECT * FROM (VALUES
    ('Raul Admin', 'admin@propanel.com', 'admin', 'active', 'admin123'),
    ('Ali Editor', 'editor@propanel.com', 'editor', 'active', 'editor123'),
    ('Zeynep Viewer', 'viewer@propanel.com', 'viewer', 'active', 'viewer123'),
    ('Mehmet Admin', 'mehmet@propanel.com', 'admin', 'active', 'admin456'),
    ('Selin Editor', 'selin@propanel.com', 'editor', 'inactive', 'editor456')
) AS v(name, email, role, status, password)
WHERE NOT EXISTS (SELECT 1 FROM users);

-- Insert default projects if table is empty
INSERT INTO projects (title, "desc", status, progress, owner, date)
SELECT * FROM (VALUES
    ('E-Ticaret Platformu', 'React & Node.js ile geliştirilmiş tam kapsamlı alışveriş sitesi.', 'active', 65, 'Raul Admin', '12 Nis 2026'),
    ('Mobil Uygulama', 'iOS ve Android için çapraz platform mobil uygulama projesi.', 'active', 40, 'Ali Editor', '08 Nis 2026'),
    ('CRM Sistemi', 'Müşteri ilişkileri yönetimi için kapsamlı dashboard uygulaması.', 'done', 100, 'Raul Admin', '01 Nis 2026'),
    ('Blog Platformu', 'Markdown destekli modern blog yönetim sistemi.', 'done', 100, 'Ali Editor', '25 Mar 2026'),
    ('Analitik Paneli', 'Gerçek zamanlı veri görselleştirme ve raporlama aracı.', 'active', 75, 'Raul Admin', '18 Mar 2026'),
    ('API Gateway', 'Mikro servis mimarisi için merkezi API yönetim katmanı.', 'pending', 15, 'Ali Editor', '10 Mar 2026'),
    ('Ödeme Entegrasyonu', 'Stripe & PayPal ile güvenli ödeme altyapısı kurulumu.', 'done', 100, 'Raul Admin', '05 Mar 2026'),
    ('Belgelendirme Sitesi', 'Docusaurus tabanlı interaktif teknik dokümantasyon sitesi.', 'active', 55, 'Ali Editor', '01 Mar 2026')
) AS v(title, "desc", status, progress, owner, date)
WHERE NOT EXISTS (SELECT 1 FROM projects);
