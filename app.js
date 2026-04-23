// =============================================
//   ProPanel — Rol Tabanlı Proje Yönetim Paneli
// =============================================

// ---- STATE ----
let currentUser = null; // Aktif kullanıcının rolü (string)
let currentUserObj = null; // Aktif kullanıcının tam nesnesi
let pendingLoginUserId = null; // Şifre beklenen kullanıcı
let loginAttempts = {};        // Hatalı giriş sayısı
let projects = [];
let users = [];

const API_URL = 'http://localhost:3000/api';

// ---- API HELPER ----
async function apiFetch(endpoint, options = {}) {
  const token = localStorage.getItem('jwt_token');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  
  const res = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: { ...headers, ...options.headers }
  });
  
  if (res.status === 401 || res.status === 403) {
    const data = await res.json().catch(() => ({}));
    showToast(data.error || 'Yetkisiz erişim', 'error');
    if (res.status === 401) {
      logout(); // Token expired or invalid
    }
    throw new Error(data.error || 'Yetkisiz erişim');
  }
  
  return res;
}


// ---- PERMISSIONS (Dinamik) ----
let PERMISSIONS = {};

function buildPermissionsForRole(roleName, rolesData) {
  const role = rolesData.find(r => r.name === roleName);
  if (!role) return {};
  
  let perms = {};
  if (role.parent_role) {
    perms = buildPermissionsForRole(role.parent_role, rolesData);
  }
  
  const ownPerms = {
    viewProjects: role.view_projects,
    createProject: role.create_project,
    editProject: role.edit_project,
    deleteProject: role.delete_project,
    manageUsers: role.manage_users,
    viewReports: role.view_reports
  };
  
  const merged = { ...perms };
  for (const k in ownPerms) {
    if (ownPerms[k]) merged[k] = true;
  }
  return merged;
}

const PERM_LABELS = {
  viewProjects: "Projeleri Görüntüle",
  createProject: "Proje Oluştur",
  editProject: "Proje Düzenle",
  deleteProject: "Proje Sil",
  manageUsers: "Kullanıcıları Yönet",
  viewReports: "Raporları Görüntüle",
};
const PERM_DENIED_MSG = {
  createProject: 'Proje oluşturmak için Editor veya Admin yetkisi gereklidir.',
  editProject: 'Proje düzelemek için Editor veya Admin yetkisi gereklidir.',
  deleteProject: 'Proje silmek için Admin yetkisi gereklidir.',
  manageUsers: 'Kullanıcıları yönetmek için Admin yetkisi gereklidir.',
  viewReports: 'Raporları görüntülemek için Admin yetkisi gereklidir.',
};

const ROLE_COLORS = { admin: "admin-avatar", editor: "editor-avatar", viewer: "viewer-avatar" };
const ROLE_DOTS = { admin: "admin-dot", editor: "editor-dot", viewer: "viewer-dot" };
const ROLE_LABELS = { admin: "Admin Modu", editor: "Editor Modu", viewer: "Viewer Modu" };

// ---- KAYNAK SAHİPLİĞİ + BAĞLAMSAL İZİNLER ----
// Editor: sadece kendi projesini düzeleyebilir
// Admin: tüm projeleri düzenliyebilir
function canEditProject(pr) {
  if (currentUser === 'admin') return true;
  if (currentUser === 'editor' && pr.owner === currentUserObj.name) return true;
  return false;
}

// Context-based silme: Editor aktif/beklemedeki projeleri silip silemiyor?
// Sadece Admin silebilir — ama "Tamamlanmış" projeleri hiç kimse silemez, yalnızca Admin.
function canDeleteProject(pr) {
  if (currentUser !== 'admin') return false;
  return true;
}

// Silme butonunun neden disabled olduğunu açıkla
function deleteBlockReason(pr) {
  if (currentUser === 'viewer') return 'Viewer rolü projeleri silemez.';
  if (currentUser === 'editor') return 'Editor rolü projeleri silemez. Bu izin yalnızca Admin\'e aittir.';
  return 'Bu işlem için yetkiniz yok.';
}

// Düzenleme butonunun neden disabled olduğunu açıkla
function editBlockReason(pr) {
  if (currentUser === 'viewer') return 'Viewer rolü projeleri düzeleyemez.';
  if (currentUser === 'editor' && pr.owner !== currentUserObj.name)
    return `Bu projenin sahibi "${pr.owner}" — yalnızca sahibi veya Admin düzelebilir.`;
  return 'Bu işlem için yetkiniz yok.';
}

// ---- API & STORAGE ----
async function loadFromApi() {
  try {
    const [pRes, uRes, rRes, aRes] = await Promise.all([
      apiFetch('/projects'),
      apiFetch('/users'),
      apiFetch('/roles'),
      apiFetch('/activities')
    ]);
    if (pRes.ok) projects = await pRes.json();
    if (uRes.ok) users = await uRes.json();
    
    if (rRes.ok) {
      const rolesData = await rRes.json();
      PERMISSIONS = {};
      rolesData.forEach(r => {
        PERMISSIONS[r.name] = buildPermissionsForRole(r.name, rolesData);
      });
    }

    if (aRes.ok) {
      const activities = await aRes.json();
      const list = document.getElementById('activity-list');
      if (list) {
        list.innerHTML = ''; // clear initial
        activities.reverse().forEach(a => renderActivityItem(a.action_html, a.color, new Date(a.created_at)));
      }
    }
  } catch (err) {
    console.error('API Error:', err);
    showToast('Sunucuya bağlanılamadı!', 'error');
  }
}



// ---- PERMISSION GUARD ----
function checkPermission(action) {
  const allowed = !!(PERMISSIONS[currentUser] && PERMISSIONS[currentUser][action]);
  logSecurityEvent(action, allowed);
  if (!allowed) showAccessDenied(PERM_DENIED_MSG[action] || 'Bu işlem için yetkiniz yok.');
  return allowed;
}

// ---- SECURITY LOG ----
function logSecurityEvent(action, allowed, actorName) {
  const list = document.getElementById('security-log-list');
  if (!list) return;
  const labels = {
    login: '🔑 Giriş', logout: '🚺 Çıkış',
    createProject: '➕ Proje Oluştur', editProject: '✏️ Proje Düzenle',
    deleteProject: '🗑 Proje Sil', manageUsers: '👥 Kullanıcı Yönet',
    viewReports: '📈 Rapor Görüntüle',
  };
  const item = document.createElement('div');
  item.className = 'security-log-item';
  const timeStr = new Date().toLocaleTimeString('tr-TR');
  item.innerHTML = `
    <span class="sec-status ${allowed ? 'sec-allowed' : 'sec-denied'}">${allowed ? '✓' : '✗'}</span>
    <span class="sec-action">${labels[action] || action}</span>
    <span class="sec-user">${actorName || currentUser || 'sistem'}</span>
    <span class="sec-time">${timeStr}</span>`;
  list.prepend(item);
  while (list.children.length > 10) list.removeChild(list.lastChild);
}

// ---- LOGIN ----
async function handleLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');

  if (!email || !password) {
    errorEl.textContent = '⚠️ E-posta ve şifre boş olamaz!';
    return;
  }

  try {
    const res = await fetch(`${API_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = `❌ ${data.error || 'Giriş başarısız!'}`;
      return;
    }
    
    localStorage.setItem('jwt_token', data.token);
    localStorage.setItem('propanel_user', JSON.stringify(data.user));
    errorEl.textContent = '';
    document.getElementById('login-email').value = '';
    document.getElementById('login-password').value = '';
    login(data.user);
  } catch (err) {
    errorEl.textContent = '❌ Sunucuya ulaşılamadı!';
  }
}

// ---- LOGIN — Adım 3: Giriş yap ----
// users dizisindeki GÜNCEL rolü okur
async function login(user) {
  if (!user) return;
  currentUser = user.role;
  currentUserObj = user; // Tam kullanıcı nesnesi kaydediliyor (ownership için)
  
  await loadFromApi(); // Fetch data now that we are authenticated
  
  document.getElementById('user-avatar').textContent = user.name[0];
  document.getElementById('user-avatar').className = 'user-avatar ' + ROLE_COLORS[user.role];
  document.getElementById('user-name').textContent = user.name;
  document.getElementById('user-role-badge').textContent = user.role.toUpperCase();
  document.getElementById('user-role-badge').className = 'user-role-badge ' + user.role + '-badge';
  document.getElementById('role-dot').className = 'role-dot ' + ROLE_DOTS[user.role];
  document.getElementById('role-label').textContent = ROLE_LABELS[user.role];
  applyNavRestrictions();
  renderPermissions();
  renderProjects();
  renderUsers();
  showSection('dashboard');
  document.getElementById('login-screen').classList.remove('active');
  document.getElementById('dashboard-screen').classList.add('active');
  document.getElementById('dashboard-screen').style.display = 'flex';
  logSecurityEvent('login', true, user.name);
  showToast('Hoşgeldiniz! ' + user.name + ' (' + user.role.toUpperCase() + ') olarak giriş yaptınız.', 'success');
}

function logout() {
  logSecurityEvent('logout', true);
  currentUser = null;
  currentUserObj = null;
  localStorage.removeItem('jwt_token');
  localStorage.removeItem('propanel_user');
  document.getElementById('dashboard-screen').classList.remove('active');
  document.getElementById('dashboard-screen').style.display = '';
  document.getElementById('login-screen').classList.add('active');
}

// ---- NAV RESTRICTIONS ----
function applyNavRestrictions() {
  const p = PERMISSIONS[currentUser];
  const userNav = document.getElementById('nav-users');
  const reportNav = document.getElementById('nav-reports');

  // Kullanıcılar menüsü — sadece Admin görür
  if (p.manageUsers) {
    userNav.style.display = '';
    userNav.onclick = () => showSection('users');
  } else {
    userNav.style.display = 'none';
  }

  // Raporlar menüsü — sadece Admin görür
  if (p.viewReports) {
    reportNav.style.display = '';
    reportNav.onclick = () => showSection('reports');
  } else {
    reportNav.style.display = 'none';
  }
}

// ---- SECTIONS ----
function showSection(name) {
  document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('section-' + name).classList.add('active');
  const navEl = document.getElementById('nav-' + name);
  if (navEl) navEl.classList.add('active');
  const titles = { dashboard: 'Dashboard', projects: 'Projeler', users: 'Kullanıcı Yönetimi', reports: 'Raporlar' };
  document.getElementById('page-title').textContent = titles[name] || name;
  if (name === 'projects') renderProjects();
  if (name === 'users') renderUsers();
}

// ---- PERMISSIONS PANEL ----
function renderPermissions() {
  const p = PERMISSIONS[currentUser];
  const container = document.getElementById('perm-list');
  container.innerHTML = Object.entries(PERM_LABELS).map(([key, label]) =>
    `<div class="perm-item">
      <span>${label}</span>
      <span class="${p[key] ? 'perm-allowed' : 'perm-denied'}">${p[key] ? '✓ İzinli' : '✗ Yasak'}</span>
    </div>`
  ).join('');
}

// ---- PROJECTS ----
function renderProjects(filter = '') {
  const p = PERMISSIONS[currentUser];
  const btnNew = document.getElementById('btn-new-project');
  btnNew.disabled = !p.createProject;
  if (!p.createProject) btnNew.onclick = () => showAccessDenied('Proje oluşturmak için yetkiniz yok.');
  else btnNew.onclick = () => openModal('new-project');

  const filtered = projects.filter(pr =>
    pr.title.toLowerCase().includes(filter.toLowerCase()) ||
    pr.desc.toLowerCase().includes(filter.toLowerCase())
  );
  const grid = document.getElementById('project-grid');
  if (filtered.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px;color:var(--muted)">Proje bulunamadı.</div>`;
    return;
  }
  grid.innerHTML = filtered.map(pr => {
    const statusLabel = { active: 'Devam Ediyor', done: 'Tamamlandı', pending: 'Beklemede' }[pr.status];
    const badgeClass = { active: 'badge-active', done: 'badge-done', pending: 'badge-pending' }[pr.status];
    const barColor = { active: '#6366f1', done: '#22c55e', pending: '#eab308' }[pr.status];

    // --- Kaynak Sahipliği + Bağlamsal İzinler ---
    const isOwner = currentUserObj && pr.owner === currentUserObj.name;
    const canEdit = canEditProject(pr);
    const canDelete = canDeleteProject(pr);
    const ownerTag = isOwner
      ? `<span style="font-size:10px;background:rgba(99,102,241,0.2);color:#818cf8;padding:2px 7px;border-radius:20px;margin-left:4px">Benim</span>`
      : '';

    const editClick = canEdit ? `openModal('edit-project', ${pr.id})` : `showAccessDenied('${editBlockReason(pr)}')`;
    const deleteClick = canDelete ? `deleteProject(${pr.id})` : `showAccessDenied('${deleteBlockReason(pr)}')`;

    const actionsHtml = (currentUser === 'viewer') ? '' : `
      <div class="project-actions">
        <button class="action-btn edit-btn"   ${!canEdit ? 'style="opacity:0.4"' : ''} onclick="${editClick}"  >✏️ Düzenle</button>
        <button class="action-btn delete-btn" ${!canDelete ? 'style="opacity:0.4"' : ''} onclick="${deleteClick}">🗑 Sil</button>
      </div>`;

    return `
    <div class="project-card status-${pr.status}">
      <div class="project-card-header">
        <div class="project-title">${pr.title}</div>
        <span class="status-badge ${badgeClass}">${statusLabel}</span>
      </div>
      <div class="project-desc">${pr.desc}</div>
      <div class="project-meta">
        <span>👤 ${pr.owner}${ownerTag}</span>
        <span>📅 ${pr.date}</span>
      </div>
      <div class="project-progress">
        <div class="progress-bar" style="width:${pr.progress}%;background:${barColor}"></div>
      </div>
      <div class="project-meta" style="margin-bottom:12px">
        <span style="font-size:11px">%${pr.progress} tamamlandı</span>
      </div>
      ${actionsHtml}
    </div>`;
  }).join('');
}

function filterProjects() {
  renderProjects(document.getElementById('project-search').value);
}

async function deleteProject(id) {
  const pr = projects.find(p => p.id === id);
  if (!canDeleteProject(pr)) { showAccessDenied(deleteBlockReason(pr)); return; }
  
  try {
    await apiFetch('/projects/${id}', { method: 'DELETE' });
    projects = projects.filter(p => p.id !== id);
    renderProjects(document.getElementById('project-search').value);
    document.getElementById('stat-projects').textContent = projects.length;
    showToast(`"${pr.title}" projesi silindi.`, 'error');
    addActivity(`<strong>${currentUserObj?.name || currentUser}</strong> projeyi sildi: <em>${pr.title}</em>`, 'red');
    logSecurityEvent('deleteProject', true);
  } catch(err) {
    showToast('Silme işlemi başarısız', 'error');
  }
}

// ---- USERS ----
function renderUsers() {
  const p = PERMISSIONS[currentUser];
  const btnInvite = document.getElementById('btn-invite-user');
  btnInvite.disabled = !p.manageUsers;
  if (!p.manageUsers) btnInvite.onclick = () => showAccessDenied('Kullanıcı eklemek için Admin yetkisi gereklidir.');
  else btnInvite.onclick = () => openModal('invite-user');

  const tbody = document.getElementById('users-tbody');
  tbody.innerHTML = users.map(u => {
    const avatarClass = ROLE_COLORS[u.role];
    const badgeClass = u.role + '-badge';
    const statusHtml = u.status === 'active'
      ? `<span class="status-active-dot">Aktif</span>`
      : `<span class="status-inactive-dot">Pasif</span>`;
    const deleteDisabled = (p.manageUsers && u.role !== 'admin') ? '' : 'disabled';
    const deleteClick = (p.manageUsers && u.role !== 'admin')
      ? `deleteUser(${u.id})`
      : (!p.manageUsers ? `showAccessDenied('Kullanıcı silmek için Admin yetkisi gereklidir.')` : `showAccessDenied('Admin kullanıcıları silinemez.')`);
    return `<tr>
      <td><div class="user-cell"><div class="avatar-sm ${avatarClass}">${u.name[0]}</div><span style="font-weight:500">${u.name}</span></div></td>
      <td style="color:var(--muted);font-size:13px">${u.email}</td>
      <td><span class="role-card-badge ${badgeClass}">${u.role.toUpperCase()}</span></td>
      <td>${statusHtml}</td>
      <td><div class="action-cell">
        <button class="btn btn-ghost" style="padding:5px 12px;font-size:12px" onclick="${p.manageUsers ? `openModal('edit-user',${u.id})` : `showAccessDenied('Kullanıcı düzenlemek için Admin yetkisi gereklidir.')`}">Düzenle</button>
        <button class="btn btn-danger" style="padding:5px 12px;font-size:12px" onclick="${deleteClick}" ${deleteDisabled}>Sil</button>
      </div></td>
    </tr>`;
  }).join('');
}

async function deleteUser(id) {
  if (!checkPermission('manageUsers')) return;
  const u = users.find(u => u.id === id);
  if (u.role === 'admin') { showAccessDenied('Admin kullanıcıları silinemez.'); return; }
  
  try {
    await apiFetch('/users/${id}', { method: 'DELETE' });
    users = users.filter(u => u.id !== id);
    renderUsers();
    document.getElementById('stat-users').textContent = users.length;
    showToast(`"${u.name}" kullanıcısı silindi.`, 'error');
    addActivity(`<strong>${currentUser}</strong> kullanıcıyı sildi: <em>${u.name}</em>`, 'red');
  } catch(err) {
    showToast('Silme işlemi başarısız', 'error');
  }
}

// ---- MODALS ----
function openModal(type, id) {
  const overlay = document.getElementById('modal-overlay');
  const title = document.getElementById('modal-title');
  const body = document.getElementById('modal-body');
  overlay.classList.add('open');

  if (type === 'new-project') {
    title.textContent = '➕ Yeni Proje Oluştur';
    body.innerHTML = `
      <div class="form-group"><label class="form-label">Proje Adı</label><input class="form-input" id="f-title" placeholder="Proje adını girin..." /></div>
      <div class="form-group"><label class="form-label">Açıklama</label><input class="form-input" id="f-desc" placeholder="Kısa açıklama..." /></div>
      <div class="form-group"><label class="form-label">Durum</label>
        <select class="form-select" id="f-status">
          <option value="active">Devam Ediyor</option>
          <option value="pending">Beklemede</option>
          <option value="done">Tamamlandı</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">İlerleme (%)</label><input class="form-input" id="f-progress" type="number" min="0" max="100" value="0" /></div>
      <div class="form-actions">
        <button class="btn btn-ghost" onclick="closeModal()">İptal</button>
        <button class="btn btn-primary" onclick="saveNewProject()">Oluştur</button>
      </div>`;
  }

  else if (type === 'edit-project') {
    const pr = projects.find(p => p.id === id);
    title.textContent = '✏️ Proje Düzenle';
    body.innerHTML = `
      <div class="form-group"><label class="form-label">Proje Adı</label><input class="form-input" id="f-title" value="${pr.title}" /></div>
      <div class="form-group"><label class="form-label">Açıklama</label><input class="form-input" id="f-desc"  value="${pr.desc}" /></div>
      <div class="form-group"><label class="form-label">Durum</label>
        <select class="form-select" id="f-status">
          <option value="active"  ${pr.status === 'active' ? 'selected' : ''}>Devam Ediyor</option>
          <option value="pending" ${pr.status === 'pending' ? 'selected' : ''}>Beklemede</option>
          <option value="done"    ${pr.status === 'done' ? 'selected' : ''}>Tamamlandı</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">İlerleme (%)</label><input class="form-input" id="f-progress" type="number" min="0" max="100" value="${pr.progress}" /></div>
      <div class="form-actions">
        <button class="btn btn-ghost" onclick="closeModal()">İptal</button>
        <button class="btn btn-primary" onclick="saveEditProject(${id})">Kaydet</button>
      </div>`;
  }

  else if (type === 'invite-user') {
    title.textContent = '👤 Yeni Kullanıcı Ekle';
    body.innerHTML = `
      <div class="form-group"><label class="form-label">Ad Soyad</label><input class="form-input" id="f-uname" placeholder="Ad Soyad..." /></div>
      <div class="form-group"><label class="form-label">E-posta</label><input class="form-input" id="f-email" type="email" placeholder="ornek@domain.com" /></div>
      <div class="form-group"><label class="form-label">Rol</label>
        <select class="form-select" id="f-role">
          <option value="viewer">Viewer</option>
          <option value="editor">Editor</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <div class="form-actions">
        <button class="btn btn-ghost" onclick="closeModal()">İptal</button>
        <button class="btn btn-primary" onclick="saveNewUser()">Ekle</button>
      </div>`;
  }

  else if (type === 'edit-user') {
    const u = users.find(u => u.id === id);
    title.textContent = '✏️ Kullanıcı Düzenle';
    body.innerHTML = `
      <div class="form-group"><label class="form-label">Ad Soyad</label><input class="form-input" id="f-uname" value="${u.name}" /></div>
      <div class="form-group"><label class="form-label">E-posta</label><input class="form-input" id="f-email" value="${u.email}" /></div>
      <div class="form-group"><label class="form-label">Rol</label>
        <select class="form-select" id="f-role">
          <option value="viewer" ${u.role === 'viewer' ? 'selected' : ''}>Viewer</option>
          <option value="editor" ${u.role === 'editor' ? 'selected' : ''}>Editor</option>
          <option value="admin"  ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
        </select>
      </div>
      <div class="form-actions">
        <button class="btn btn-ghost" onclick="closeModal()">İptal</button>
        <button class="btn btn-primary" onclick="saveEditUser(${id})">Kaydet</button>
      </div>`;
  }
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}

async function saveNewProject() {
  if (!checkPermission('createProject')) return;
  const title = document.getElementById('f-title').value.trim();
  const desc = document.getElementById('f-desc').value.trim();
  let status = document.getElementById('f-status').value;
  const progress = parseInt(document.getElementById('f-progress').value) || 0;
  if (progress === 100) status = 'done';

  if (!title) { showToast('Proje adı boş olamaz!', 'error'); return; }
  const now = new Date();
  const dateStr = now.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });
  const newPrData = { title, desc: desc || 'Açıklama yok.', status, progress, owner: currentUserObj.name, date: dateStr };
  
  try {
    const res = await apiFetch('/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newPrData)
    });
    const newPr = await res.json();
    projects.unshift(newPr);
    closeModal();
    renderProjects(document.getElementById('project-search').value);
    document.getElementById('stat-projects').textContent = projects.length;
    showToast(`"${title}" projesi oluşturuldu!`, 'success');
    addActivity(`<strong>${currentUser}</strong> yeni proje oluşturdu: <em>${title}</em>`, 'green');
  } catch(err) {
    showToast('Kaydetme başarısız', 'error');
  }
}

async function saveEditProject(id) {
  if (!checkPermission('editProject')) return;
  const pr = projects.find(p => p.id === id);
  const title = document.getElementById('f-title').value.trim() || pr.title;
  const desc = document.getElementById('f-desc').value.trim() || pr.desc;
  let status = document.getElementById('f-status').value;
  const progress = parseInt(document.getElementById('f-progress').value) || 0;
  if (progress === 100) status = 'done';
  
  try {
    const res = await apiFetch('/projects/${id}', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, desc, status, progress })
    });
    const updated = await res.json();
    Object.assign(pr, updated);
    closeModal();
    renderProjects(document.getElementById('project-search').value);
    showToast(`"${pr.title}" güncellendi!`, 'info');
    addActivity(`<strong>${currentUser}</strong> proje güncelledi: <em>${pr.title}</em>`, 'blue');
  } catch(err) {
    showToast('Güncelleme başarısız', 'error');
  }
}

async function saveNewUser() {
  if (!checkPermission('manageUsers')) return;
  const name = document.getElementById('f-uname').value.trim();
  const email = document.getElementById('f-email').value.trim();
  const role = document.getElementById('f-role').value;
  if (!name || !email) { showToast('Ad ve e-posta zorunludur!', 'error'); return; }
  const password = role + Math.floor(Math.random()*10000);
  
  try {
    const res = await apiFetch('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, role, status: 'active', password })
    });
    const newU = await res.json();
    users.push(newU);
    closeModal();
    renderUsers();
    document.getElementById('stat-users').textContent = users.length;
    showToast(`"${name}" kullanıcısı eklendi!`, 'success');
    addActivity(`<strong>${currentUser}</strong> kullanıcı ekledi: <em>${name}</em>`, 'green');
  } catch(err) {
    showToast('Kullanıcı eklenemedi', 'error');
  }
}

async function saveEditUser(id) {
  if (!checkPermission('manageUsers')) return;
  const u = users.find(u => u.id === id);
  const name = document.getElementById('f-uname').value.trim() || u.name;
  const email = document.getElementById('f-email').value.trim() || u.email;
  const role = document.getElementById('f-role').value;
  
  try {
    const res = await apiFetch('/users/${id}', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, role })
    });
    const updated = await res.json();
    Object.assign(u, updated);
    closeModal();
    renderUsers();
    showToast(`"${u.name}" güncellendi!`, 'info');
    addActivity(`<strong>${currentUser}</strong> kullanıcı rolünü değiştirdi: <em>${u.name} → ${u.role}</em>`, 'blue');
  } catch(err) {
    showToast('Güncelleme başarısız', 'error');
  }
}

// ---- ACCESS DENIED ----
function showAccessDenied(msg) {
  document.getElementById('denied-msg').textContent = msg;
  document.getElementById('access-denied').style.display = 'flex';
}

// ---- TOAST ----
function showToast(msg, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${type} show`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.className = 'toast'; }, 3200);
}

// ---- ACTIVITY ----
function renderActivityItem(html, color, dateObj = new Date()) {
  const list = document.getElementById('activity-list');
  if (!list) return;
  const colorMap = { green: 'green-dot', blue: 'blue-dot', yellow: 'yellow-dot', red: 'red-dot' };
  const item = document.createElement('div');
  item.className = 'activity-item';
  const timeStr = dateObj.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  item.innerHTML = `<div class="activity-dot ${colorMap[color] || 'blue-dot'}"></div><div class="activity-text">${html}</div><div class="activity-time">${timeStr}</div>`;
  list.prepend(item);
  if (list.children.length > 10) list.removeChild(list.lastChild);
}

async function addActivity(html, color) {
  renderActivityItem(html, color); // anında göster
  try {
    await apiFetch('/activities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_name: currentUserObj?.name || currentUser || 'Sistem', action_html: html, color })
    });
  } catch(err) {
    console.error('Aktivite kaydedilemedi', err);
  }
}
// ---- INIT ----
const savedUser = localStorage.getItem('propanel_user');
const savedToken = localStorage.getItem('jwt_token');
if (savedUser && savedToken) {
  login(JSON.parse(savedUser));
}
