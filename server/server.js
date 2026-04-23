const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-for-propanel';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../'))); // Serve frontend

// ---- DATABASE INIT & MIGRATION ----
async function initDb() {
  try {
    const initSql = fs.readFileSync(path.join(__dirname, 'init.sql'), 'utf8');
    await db.query(initSql);
    
    // Hash default passwords if they are plain text
    const { rows } = await db.query('SELECT id, password FROM users');
    for (const u of rows) {
      if (!u.password.startsWith('$2a$') && !u.password.startsWith('$2b$')) {
        const hash = bcrypt.hashSync(u.password, 10);
        await db.query('UPDATE users SET password = $1 WHERE id = $2', [hash, u.id]);
      }
    }
    console.log('Database initialized successfully.');
  } catch (err) {
    console.error('Failed to initialize database:', err);
  }
}

// ---- MIDDLEWARES ----

// 1. JWT Doğrulama (Kimlik Kontrolü)
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.status(401).json({ error: 'Erişim reddedildi. Token bulunamadı.' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Geçersiz veya süresi dolmuş token.' });
    req.user = user; // user payload: { id, email, role, name }
    next();
  });
}

// 2. Rol Hiyerarşisi Hesaplayıcı (Veritabanından)
async function getResolvedPermissions(roleName) {
  const { rows } = await db.query('SELECT * FROM roles');
  
  function buildPerms(rName) {
    const role = rows.find(r => r.name === rName);
    if (!role) return {};
    
    let perms = {};
    if (role.parent_role) perms = buildPerms(role.parent_role);
    
    const ownPerms = {
      viewProjects: role.view_projects,
      createProject: role.create_project,
      editProject: role.edit_project,
      deleteProject: role.delete_project,
      manageUsers: role.manage_users,
      viewReports: role.view_reports
    };
    
    const merged = { ...perms };
    for (const k in ownPerms) { if (ownPerms[k]) merged[k] = true; }
    return merged;
  }
  
  return buildPerms(roleName);
}

// 3. İzin Kontrolcüsü (RBAC Middleware)
function requirePermission(action) {
  return async (req, res, next) => {
    try {
      const perms = await getResolvedPermissions(req.user.role);
      if (!perms[action]) {
        return res.status(403).json({ error: 'Bu işlem için yetkiniz bulunmamaktadır.' });
      }
      next();
    } catch (err) {
      res.status(500).json({ error: 'Yetki kontrolü sırasında hata oluştu.' });
    }
  };
}

// Start Server
app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
  await initDb();
});

// --- PUBLIC ENDPOINTS ---

// Login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    if (rows.length === 0) return res.status(401).json({ error: 'Kullanıcı bulunamadı.' });
    
    const user = rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(401).json({ error: 'Geçersiz şifre.' });
    
    // Generate JWT
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    // Şifreyi frontend'e göndermemek için siliyoruz
    delete user.password;
    res.json({ token, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// --- PROTECTED ENDPOINTS ---

// Get all roles
app.get('/api/roles', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM roles');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get recent activities
app.get('/api/activities', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM activities ORDER BY created_at DESC LIMIT 10');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create activity
app.post('/api/activities', authenticateToken, async (req, res) => {
  const { user_name, action_html, color } = req.body;
  try {
    const { rows } = await db.query(
      'INSERT INTO activities (user_name, action_html, color) VALUES ($1, $2, $3) RETURNING *',
      [user_name, action_html, color]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all users (Admin only technically, but we let anyone view users for rendering UI)
// But we MUST remove passwords!
app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT id, name, email, role, status FROM users ORDER BY id ASC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create user
app.post('/api/users', authenticateToken, requirePermission('manageUsers'), async (req, res) => {
  const { name, email, role, status, password } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await db.query(
      'INSERT INTO users (name, email, role, status, password) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, role, status',
      [name, email, role, status, hash]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update user
app.put('/api/users/:id', authenticateToken, requirePermission('manageUsers'), async (req, res) => {
  const { id } = req.params;
  const { name, email, role, status, password } = req.body;
  try {
    const fields = [];
    const values = [];
    let queryIdx = 1;
    
    if (name) { fields.push(`name = $${queryIdx++}`); values.push(name); }
    if (email) { fields.push(`email = $${queryIdx++}`); values.push(email); }
    if (role) { fields.push(`role = $${queryIdx++}`); values.push(role); }
    if (status) { fields.push(`status = $${queryIdx++}`); values.push(status); }
    if (password) { 
      const hash = await bcrypt.hash(password, 10);
      fields.push(`password = $${queryIdx++}`); 
      values.push(hash); 
    }

    if (fields.length === 0) return res.json({});

    values.push(id);
    const query = `UPDATE users SET ${fields.join(', ')} WHERE id = $${queryIdx} RETURNING id, name, email, role, status`;
    
    const { rows } = await db.query(query, values);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete user
app.delete('/api/users/:id', authenticateToken, requirePermission('manageUsers'), async (req, res) => {
  try {
    await db.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Get all projects
app.get('/api/projects', authenticateToken, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM projects ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create project
app.post('/api/projects', authenticateToken, requirePermission('createProject'), async (req, res) => {
  const { title, desc, status, progress, owner, date } = req.body;
  try {
    const { rows } = await db.query(
      'INSERT INTO projects (title, "desc", status, progress, owner, date) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [title, desc, status, progress, owner, date]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update project (Needs ABAC: only owner or admin)
app.put('/api/projects/:id', authenticateToken, requirePermission('editProject'), async (req, res) => {
  const { id } = req.params;
  const { title, desc, status, progress } = req.body;
  
  try {
    // ABAC Check
    const prCheck = await db.query('SELECT owner FROM projects WHERE id = $1', [id]);
    if (prCheck.rows.length === 0) return res.status(404).json({ error: 'Proje bulunamadı.' });
    if (req.user.role !== 'admin' && prCheck.rows[0].owner !== req.user.name) {
      return res.status(403).json({ error: 'Sadece kendi projelerinizi düzenleyebilirsiniz.' });
    }

    const fields = [];
    const values = [];
    let queryIdx = 1;
    
    if (title) { fields.push(`title = $${queryIdx++}`); values.push(title); }
    if (desc) { fields.push(`"desc" = $${queryIdx++}`); values.push(desc); }
    if (status) { fields.push(`status = $${queryIdx++}`); values.push(status); }
    if (progress !== undefined) { fields.push(`progress = $${queryIdx++}`); values.push(progress); }

    if (fields.length === 0) return res.json({});

    values.push(id);
    const query = `UPDATE projects SET ${fields.join(', ')} WHERE id = $${queryIdx} RETURNING *`;
    
    const { rows } = await db.query(query, values);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete project
app.delete('/api/projects/:id', authenticateToken, requirePermission('deleteProject'), async (req, res) => {
  try {
    await db.query('DELETE FROM projects WHERE id = $1', [req.params.id]);
    res.json({ message: 'Project deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
