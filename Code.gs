// ============================================================
//  PrintShop Pro — Google Apps Script Backend  (Code.gs)
//  FIXED v3 — All audit issues resolved
// ============================================================

// ── DEFAULT CONFIGURATION (fallbacks when Settings not saved) ─
const SS_ID       = 'YOUR_SPREADSHEET_ID';   // ← Replace once
const FOLDER_ID   = 'YOUR_DRIVE_FOLDER_ID';  // ← Replace once
const ADMIN_CREDS = { email: 'admin@printshop.com', password: 'Admin@123' };
const SHOP        = { name: 'PrintShop Pro', upiId: 'yourname@paytm' };
const PRICING     = { base:10, bwPerPage:1.5, colorPerPage:5, a3Multi:1.8, customMulti:2.0, urgentFee:50, deliveryFee:60 };
const MAX_FILE_MB = 10;

// ── DYNAMIC SETTINGS ──────────────────────────────────────────
// Reads from Script Properties at runtime; falls back to consts above.
// Admin can change these via the Settings page in the Admin panel.
function liveSettings() {
  try {
    const p = PropertiesService.getScriptProperties().getProperties();
    return {
      shopName    : p.SHOP_NAME      || SHOP.name,
      upiId       : p.SHOP_UPI       || SHOP.upiId,
      pricing: {
        base        : parseFloat(p.PRICE_BASE)     || PRICING.base,
        bwPerPage   : parseFloat(p.PRICE_BW)       || PRICING.bwPerPage,
        colorPerPage: parseFloat(p.PRICE_COLOR)    || PRICING.colorPerPage,
        a3Multi     : parseFloat(p.PRICE_A3)       || PRICING.a3Multi,
        customMulti : parseFloat(p.PRICE_CUSTOM)   || PRICING.customMulti,
        urgentFee   : parseFloat(p.PRICE_URGENT)   || PRICING.urgentFee,
        deliveryFee : parseFloat(p.PRICE_DELIVERY) || PRICING.deliveryFee
      },
      qrExpiryMin : parseInt(p.QR_EXPIRY)    || 15,
      retryLimit  : parseInt(p.RETRY_LIMIT)  || 3,
      autoApprove : parseInt(p.AUTO_APPROVE) || 80,
      needsReview : parseInt(p.NEEDS_REVIEW) || 50
    };
  } catch(e) {
    return { shopName:SHOP.name, upiId:SHOP.upiId, pricing:PRICING,
             qrExpiryMin:15, retryLimit:3, autoApprove:80, needsReview:50 };
  }
}

// Called by Admin Settings page to load current values
function getShopSettings(token) {
  if (!checkAdminSession(token)) return { ok:false, err:'Unauthorized' };
  return { ok:true, settings: liveSettings() };
}

// Called by Admin Settings page to save values
function saveShopSettings(cfg, token) {
  if (!checkAdminSession(token)) return { ok:false, err:'Unauthorized' };
  try {
    const p = PropertiesService.getScriptProperties();
    if (cfg.shopName)     p.setProperty('SHOP_NAME',      cfg.shopName.trim());
    if (cfg.upiId)        p.setProperty('SHOP_UPI',        cfg.upiId.trim());
    const pr = cfg.pricing || {};
    const num = (v, fb) => String(parseFloat(v) || fb);
    if (pr.base         != null) p.setProperty('PRICE_BASE',     num(pr.base,        PRICING.base));
    if (pr.bwPerPage    != null) p.setProperty('PRICE_BW',       num(pr.bwPerPage,   PRICING.bwPerPage));
    if (pr.colorPerPage != null) p.setProperty('PRICE_COLOR',    num(pr.colorPerPage,PRICING.colorPerPage));
    if (pr.a3Multi      != null) p.setProperty('PRICE_A3',       num(pr.a3Multi,     PRICING.a3Multi));
    if (pr.customMulti  != null) p.setProperty('PRICE_CUSTOM',   num(pr.customMulti, PRICING.customMulti));
    if (pr.urgentFee    != null) p.setProperty('PRICE_URGENT',   num(pr.urgentFee,   PRICING.urgentFee));
    if (pr.deliveryFee  != null) p.setProperty('PRICE_DELIVERY', num(pr.deliveryFee, PRICING.deliveryFee));
    const int = (v, fb) => String(parseInt(v) || fb);
    if (cfg.qrExpiryMin != null) p.setProperty('QR_EXPIRY',    int(cfg.qrExpiryMin, 15));
    if (cfg.retryLimit  != null) p.setProperty('RETRY_LIMIT',  int(cfg.retryLimit,  3));
    if (cfg.autoApprove != null) p.setProperty('AUTO_APPROVE', int(cfg.autoApprove, 80));
    if (cfg.needsReview != null) p.setProperty('NEEDS_REVIEW', int(cfg.needsReview, 50));
    return { ok:true };
  } catch(e) { return { ok:false, err:e.message }; }
}

// Public endpoint — frontend uses this to sync pricing before rendering summary
function getPublicPricing() {
  const s = liveSettings();
  return { ok:true, pricing:s.pricing, shopName:s.shopName };
}

// ── REST API ROUTER ─────────────────────────────────────────────
// Frontend hosted on Vercel → POST { action, args } → returns JSON

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || '';
  if (action === 'ping') return _respond({ ok:true, msg:'PrintShop Pro API v3 — online' });
  return _respond({ ok:true, service:'PrintShop Pro API', version:'3.0',
    note:'Use POST with { action, args } to call functions.' });
}

function doPost(e) {
  let result;
  try {
    if (!e.postData || !e.postData.contents) throw new Error('Empty request body');
    const body   = JSON.parse(e.postData.contents);
    const action = String(body.action || '');
    const args   = Array.isArray(body.args) ? body.args : [];

    const FN_MAP = {
      // Auth
      loginUser, registerUser, adminLogin,
      // User
      getUserOrders, createOrder, reorderItem,
      // Files — uploadPrintFile only (uploadScreenshot is internal, called by submitSmartPayment)
      uploadPrintFile,
      // Pricing & Settings
      getPublicPricing, getShopSettings, saveShopSettings,
      // Admin — Orders
      adminGetStats, adminGetAllOrders, adminUpdateStatus,
      // Catalog — Services
      getServicesData, addServiceData, updateServiceData, deleteServiceData,
      // Catalog — Products
      getProductsData, addProductData, updateProductData, deleteProductData,
      // Payments (PaymentSystem.gs)
      initPaymentSession, regeneratePaymentQR, submitSmartPayment,
      getPaymentStatus, adminGetPaymentLedger,
      adminApprovePayment, adminRejectSmartPayment, adminGetFraudLog
    };

    const fn = FN_MAP[action];
    result = fn ? fn(...args) : { ok:false, err:'Unknown action: ' + action };
  } catch(err) {
    result = { ok:false, err:err.message };
  }
  return _respond(result);
}

function _respond(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── SHEET HELPERS ─────────────────────────────────────────────
function ss()  { return SpreadsheetApp.openById(SS_ID); }
function sh(n) {
  const s = ss().getSheetByName(n);
  if (!s) throw new Error('Sheet "' + n + '" not found. Run fullSystemSetup() first.');
  return s;
}
function getData(name) {
  try {
    const s = ss().getSheetByName(name); if (!s) return [];
    const raw = s.getDataRange().getValues(); if (raw.length <= 1) return [];
    const hdr = raw[0];
    return raw.slice(1).map(r =>
      Object.fromEntries(hdr.map((k, i) => [String(k).trim(), r[i] === null ? '' : r[i]]))
    );
  } catch(e) { Logger.log('getData error for ' + name + ': ' + e); return []; }
}
function append(name, row)      { sh(name).appendRow(row); }
function setCell(name, r, c, v) { sh(name).getRange(r, c).setValue(v); }
function findRow(name, colIdx, val) {
  try {
    const vals = sh(name).getDataRange().getValues();
    for (let i = 1; i < vals.length; i++)
      if (String(vals[i][colIdx]).trim() === String(val).trim()) return i + 1;
  } catch(e) {}
  return -1;
}
function uid(pfx) {
  return pfx + '_' + Date.now() + '_' + Math.random().toString(36).slice(2,7).toUpperCase();
}
function sha256(str) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str)
    .map(b => ('0' + (b & 255).toString(16)).slice(-2)).join('');
}

// ── ONE-TIME SETUP ────────────────────────────────────────────
function setupSheets() {
  const sp = ss();
  [
    ['Users',    ['user_id','name','email','password','phone','created_at','session_token','token_expiry']],
    ['Orders',   ['order_id','user_id','user_email','file_url','file_name','pages','color_type',
                  'size','quantity','urgent','delivery_type','address','base_price','total_price',
                  'status','payment_status','notes','created_at']],
    ['Services', ['service_id','name','description','base_price','bw_per_page','color_per_page','active','created_at']],
    ['Products', ['product_id','name','description','price','stock','active','created_at']]
  ].forEach(([name, headers]) => {
    const s = sp.getSheetByName(name) || sp.insertSheet(name);
    if (s.getLastRow() === 0) s.appendRow(headers);
  });
  const svc = sp.getSheetByName('Services');
  if (svc.getLastRow() <= 1)
    svc.appendRow([uid('SVC'),'Standard Printing','B&W and Color printing',10,1.5,5,true,new Date().toISOString()]);
  return '✅ Base sheets ready!';
}
function fullSystemSetup() {
  setupSheets();
  setupPaymentSheets(); // defined in PaymentSystem.gs
  return '✅ All sheets created!';
}

// ── AUTH ──────────────────────────────────────────────────────
function registerUser(name, email, password, phone) {
  try {
    if (!name || !email || !password || !phone) return { ok:false, err:'All fields required' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok:false, err:'Invalid email address' };
    if (password.length < 6) return { ok:false, err:'Password must be at least 6 characters' };
    if (!/^\d{10}$/.test(phone.trim())) return { ok:false, err:'Enter a valid 10-digit phone number' };
    const users = getData('Users');
    if (users.find(u => String(u.email).toLowerCase() === email.toLowerCase().trim()))
      return { ok:false, err:'Email already registered' };
    const id = uid('USR'), now = new Date().toISOString(), s = liveSettings();
    append('Users', [id, name.trim(), email.toLowerCase().trim(), sha256(password), phone.trim(), now, '', '']);
    try { MailApp.sendEmail({ to:email, subject:`Welcome to ${s.shopName}!`,
      htmlBody:`<p>Hi <b>${name}</b>,</p><p>Welcome to <b>${s.shopName}</b>! Your account is ready.</p>` }); } catch(e) {}
    return { ok:true, msg:'Registration successful! Please login.' };
  } catch(e) { return { ok:false, err:e.message }; }
}

function loginUser(email, password) {
  try {
    if (!email || !password) return { ok:false, err:'Email and password required' };
    const users = getData('Users'), hashed = sha256(password);
    const u = users.find(x =>
      String(x.email).toLowerCase().trim() === email.toLowerCase().trim() &&
      String(x.password).trim() === hashed
    );
    if (!u) return { ok:false, err:'Invalid email or password' };
    const token = Utilities.getUuid(), expiry = new Date(Date.now() + 86400000).toISOString();
    const ri = findRow('Users', 0, u.user_id);
    if (ri > 0) { setCell('Users', ri, 7, token); setCell('Users', ri, 8, expiry); }
    return { ok:true, user:{ id:u.user_id, name:u.name, email:u.email, phone:u.phone }, token };
  } catch(e) { return { ok:false, err:e.message }; }
}

function adminLogin(email, password) {
  if (email === ADMIN_CREDS.email && password === ADMIN_CREDS.password) {
    const t = Utilities.getUuid();
    PropertiesService.getScriptProperties()
      .setProperty('AT_' + t, new Date(Date.now() + 28800000).toISOString());
    return { ok:true, token:t };
  }
  return { ok:false, err:'Invalid admin credentials' };
}

function checkUserSession(userId, token) {
  if (!userId || !token) return false;
  const u = getData('Users').find(x =>
    String(x.user_id).trim() === String(userId).trim() &&
    String(x.session_token).trim() === String(token).trim()
  );
  return !!(u && new Date(u.token_expiry) > new Date());
}

function checkAdminSession(token) {
  if (!token) return false;
  const p = PropertiesService.getScriptProperties(), exp = p.getProperty('AT_' + token);
  if (!exp) return false;
  if (new Date(exp) < new Date()) { p.deleteProperty('AT_' + token); return false; }
  return true;
}

// ── FILE UPLOAD ───────────────────────────────────────────────
function uploadPrintFile(b64, name, mime, userId, token) {
  if (!checkUserSession(userId, token)) return { ok:false, err:'Session expired. Please login again.' };
  try {
    if (!['application/pdf','image/jpeg','image/png','image/jpg'].includes(mime))
      return { ok:false, err:'Only PDF, JPG, PNG files allowed' };
    if (!b64) return { ok:false, err:'No file data received' };
    const bytes = Utilities.base64Decode(b64), sizeMB = bytes.length / 1048576;
    if (sizeMB > MAX_FILE_MB) return { ok:false, err:`File too large (max ${MAX_FILE_MB} MB)` };
    const folder = DriveApp.getFolderById(FOLDER_ID);
    const file   = folder.createFile(Utilities.newBlob(bytes, mime, name));
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return { ok:true, fileId:file.getId(),
      fileUrl: file.getDownloadUrl(),
      viewUrl: 'https://drive.google.com/file/d/' + file.getId() + '/view',
      name, sizeMB: Math.round(sizeMB * 100) / 100 };
  } catch(e) { return { ok:false, err:e.message }; }
}

function uploadScreenshot(b64, name, mime, orderId) {
  try {
    if (!b64) return { ok:false, err:'Empty screenshot data' };
    const folder = DriveApp.getFolderById(FOLDER_ID);
    const file   = folder.createFile(
      Utilities.newBlob(Utilities.base64Decode(b64), mime, 'pay_' + orderId + '_' + name));
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return { ok:true, url:'https://drive.google.com/file/d/' + file.getId() + '/view' };
  } catch(e) { return { ok:false, err:e.message }; }
}

// ── PRICING ENGINE ────────────────────────────────────────────
function calcPrice(pages, colorType, size, qty, urgent, delivery) {
  const pr = liveSettings().pricing;
  const p = Math.max(1, parseInt(pages)||1), q = Math.max(1, parseInt(qty)||1);
  const pp = colorType === 'color' ? pr.colorPerPage : pr.bwPerPage;
  let print = pr.base + p * pp * q;
  if (size === 'A3')     print *= pr.a3Multi;
  if (size === 'Custom') print *= pr.customMulti;
  const urgentFee   = urgent             ? pr.urgentFee   : 0;
  const deliveryFee = delivery==='delivery' ? pr.deliveryFee : 0;
  const total = Math.round((print + urgentFee + deliveryFee) * 100) / 100;
  return { base:pr.base, printCost:Math.round(p*pp*q*100)/100, urgentFee, deliveryFee, total,
    breakdown:`${p} pg × ₹${pp} × ${q} copy = ₹${Math.round(p*pp*q*100)/100}` };
}

// ── ORDERS ────────────────────────────────────────────────────
function createOrder(d, userId, token) {
  if (!checkUserSession(userId, token)) return { ok:false, err:'Session expired. Please login again.' };
  try {
    const user = getData('Users').find(u => String(u.user_id) === String(userId));
    if (!user) return { ok:false, err:'User account not found' };
    // FIXED: validate file is uploaded before order can be created
    if (!d.fileUrl || !String(d.fileUrl).trim())
      return { ok:false, err:'Please upload your print file before placing an order.' };
    if (d.delivery === 'delivery' && (!d.address || !d.address.trim()))
      return { ok:false, err:'Delivery address is required for home delivery' };
    const id = uid('ORD'), price = calcPrice(d.pages, d.colorType, d.size, d.qty, d.urgent, d.delivery);
    const now = new Date().toISOString(), s = liveSettings();
    append('Orders', [
      id, userId, user.email, d.fileUrl||'', d.fileName||'',
      parseInt(d.pages)||1, d.colorType||'bw', d.size||'A4', parseInt(d.qty)||1,
      d.urgent?'Yes':'No', d.delivery||'pickup', d.address?d.address.trim():'',
      price.base, price.total, 'Pending Payment', 'Unpaid', d.notes?d.notes.trim():'', now
    ]);
    try { MailApp.sendEmail({ to:user.email,
      subject:`Order Placed — ${id} | ${s.shopName}`,
      htmlBody:_orderEmailHtml(user.name, id, price.total, 'Pending Payment', s.shopName) }); } catch(e) {}
    return { ok:true, orderId:id, price };
  } catch(e) { return { ok:false, err:e.message }; }
}

function getUserOrders(userId, token) {
  if (!checkUserSession(userId, token)) return { ok:false, err:'Session expired' };
  try {
    const orders = getData('Orders')
      .filter(o => String(o.user_id) === String(userId))
      .sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    const ledger = getData('PaymentLedger');
    return { ok:true, orders: orders.map(o => ({
      ...o,
      payment: ledger
        .filter(p => String(p.order_id) === String(o.order_id))
        .sort((a,b) => new Date(b.submitted_at) - new Date(a.submitted_at))[0] || null
    }))};
  } catch(e) { return { ok:false, err:e.message }; }
}

function reorderItem(orderId, userId, token) {
  if (!checkUserSession(userId, token)) return { ok:false, err:'Session expired' };
  const o = getData('Orders').find(x =>
    String(x.order_id) === String(orderId) && String(x.user_id) === String(userId));
  if (!o) return { ok:false, err:'Order not found' };
  return { ok:true, data:{ fileUrl:o.file_url, fileName:o.file_name, pages:o.pages,
    colorType:o.color_type, size:o.size, qty:o.quantity,
    urgent:o.urgent==='Yes', delivery:o.delivery_type, address:o.address }};
}

// ── ADMIN — ORDERS ────────────────────────────────────────────
function adminGetAllOrders(token) {
  if (!checkAdminSession(token)) return { ok:false, err:'Unauthorized' };
  try {
    const orders = getData('Orders').sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    const ledger = getData('PaymentLedger');
    return { ok:true, orders: orders.map(o => ({
      ...o,
      payment: ledger
        .filter(p => String(p.order_id) === String(o.order_id))
        .sort((a,b) => new Date(b.submitted_at) - new Date(a.submitted_at))[0] || null
    }))};
  } catch(e) { return { ok:false, err:e.message }; }
}

function adminUpdateStatus(orderId, status, token) {
  if (!checkAdminSession(token)) return { ok:false, err:'Unauthorized' };
  const ri = findRow('Orders', 0, orderId);
  if (ri < 0) return { ok:false, err:'Order not found' };
  setCell('Orders', ri, 15, status);
  try {
    const o = getData('Orders').find(x => String(x.order_id) === String(orderId));
    const s = liveSettings();
    if (o && o.user_email && ['Ready','Delivered','Accepted'].includes(status))
      MailApp.sendEmail({ to:o.user_email,
        subject:`Your Order is ${status} — ${orderId} | ${s.shopName}`,
        htmlBody:_orderEmailHtml('Customer', orderId, o.total_price, status, s.shopName) });
  } catch(e) {}
  return { ok:true };
}

// FIXED: Recent orders now joined with PaymentLedger so score shows in dashboard
function adminGetStats(token) {
  if (!checkAdminSession(token)) return { ok:false, err:'Unauthorized' };
  try {
    const orders = getData('Orders'), ledger = getData('PaymentLedger');
    const today  = new Date().toDateString();
    const statusList = ['Pending Payment','Pending Verification','Accepted','Printing','Ready','Delivered','Payment Rejected','Payment Expired'];
    const sortedOrders = [...orders].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    const recent = sortedOrders.slice(0,8).map(o => ({
      ...o,
      payment: ledger
        .filter(p => String(p.order_id) === String(o.order_id))
        .sort((a,b) => new Date(b.submitted_at) - new Date(a.submitted_at))[0] || null
    }));
    return { ok:true, stats:{
      total    : orders.length,
      pending  : ledger.filter(p => String(p.admin_status) === 'Pending').length,
      completed: orders.filter(o => String(o.status) === 'Delivered').length,
      revenue  : Math.round(orders
        .filter(o => new Date(o.created_at).toDateString() === today && String(o.payment_status) === 'Paid')
        .reduce((s,o) => s + parseFloat(o.total_price||0), 0) * 100) / 100,
      byStatus : statusList.reduce((a,s) => { a[s]=orders.filter(o=>String(o.status)===s).length; return a; }, {}),
      recent
    }};
  } catch(e) { return { ok:false, err:e.message }; }
}

// ── ADMIN — SERVICES CRUD ─────────────────────────────────────
function getServicesData() {
  try { return { ok:true, services:getData('Services') }; } catch(e) { return { ok:false, err:e.message }; }
}
function addServiceData(n,d,b,bw,col,token) {
  if (!checkAdminSession(token)) return { ok:false, err:'Unauthorized' };
  if (!n||!n.trim()) return { ok:false, err:'Name required' };
  const id=uid('SVC'); append('Services',[id,n.trim(),d||'',parseFloat(b)||0,parseFloat(bw)||0,parseFloat(col)||0,true,new Date().toISOString()]); return { ok:true, id };
}
function updateServiceData(id,n,d,b,bw,col,active,token) {
  if (!checkAdminSession(token)) return { ok:false, err:'Unauthorized' };
  const ri=findRow('Services',0,id); if (ri<0) return { ok:false, err:'Not found' };
  sh('Services').getRange(ri,2,1,6).setValues([[n,d,parseFloat(b)||0,parseFloat(bw)||0,parseFloat(col)||0,active]]); return { ok:true };
}
function deleteServiceData(id,token) {
  if (!checkAdminSession(token)) return { ok:false, err:'Unauthorized' };
  const ri=findRow('Services',0,id); if (ri<0) return { ok:false, err:'Not found' };
  sh('Services').deleteRow(ri); return { ok:true };
}

// ── ADMIN — PRODUCTS CRUD ─────────────────────────────────────
function getProductsData() {
  try { return { ok:true, products:getData('Products') }; } catch(e) { return { ok:false, err:e.message }; }
}
function addProductData(n,d,p,s,token) {
  if (!checkAdminSession(token)) return { ok:false, err:'Unauthorized' };
  if (!n||!n.trim()) return { ok:false, err:'Name required' };
  const id=uid('PRD'); append('Products',[id,n.trim(),d||'',parseFloat(p)||0,parseInt(s)||0,true,new Date().toISOString()]); return { ok:true, id };
}
function updateProductData(id,n,d,p,s,active,token) {
  if (!checkAdminSession(token)) return { ok:false, err:'Unauthorized' };
  const ri=findRow('Products',0,id); if (ri<0) return { ok:false, err:'Not found' };
  sh('Products').getRange(ri,2,1,5).setValues([[n,d,parseFloat(p)||0,parseInt(s)||0,active]]); return { ok:true };
}
function deleteProductData(id,token) {
  if (!checkAdminSession(token)) return { ok:false, err:'Unauthorized' };
  const ri=findRow('Products',0,id); if (ri<0) return { ok:false, err:'Not found' };
  sh('Products').deleteRow(ri); return { ok:true };
}

// ── EMAIL TEMPLATES ───────────────────────────────────────────
function _orderEmailHtml(name, id, total, status, shopName) {
  const sn = shopName || liveSettings().shopName;
  const c = {'Pending Payment':'#f59e0b','Accepted':'#2563eb','Printing':'#7c3aed',
    'Ready':'#16a34a','Delivered':'#065f46','Payment Rejected':'#dc2626','Payment Expired':'#6b7280'}[status]||'#374151';
  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.1)">
<div style="background:#2563eb;color:#fff;padding:28px;text-align:center"><h2 style="margin:0">🖨️ ${sn}</h2></div>
<div style="padding:28px;background:#f9fafb"><h3>Hello ${name}!</h3>
<table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden">
<tr><td style="padding:11px 16px;border-bottom:1px solid #e5e7eb;color:#6b7280">Order ID</td><td style="padding:11px 16px;border-bottom:1px solid #e5e7eb;font-weight:600">${id}</td></tr>
<tr><td style="padding:11px 16px;border-bottom:1px solid #e5e7eb;color:#6b7280">Amount</td><td style="padding:11px 16px;border-bottom:1px solid #e5e7eb;font-weight:600">₹${total}</td></tr>
<tr><td style="padding:11px 16px;color:#6b7280">Status</td><td style="padding:11px 16px;font-weight:700;color:${c}">${status}</td></tr>
</table><p style="margin-top:24px;color:#6b7280;font-size:13px">Thank you for choosing <b>${sn}</b>! 🎉</p></div></div>`;
}
