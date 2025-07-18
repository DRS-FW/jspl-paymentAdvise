require('dotenv').config();

const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_FILE_URL = process.env.PUBLIC_FILE_HOST;
const MAINTENANCE_KEY = process.env.MAINTENANCE_KEY;

const FILE_DIR = 'public'; // Keep folder name 'public' for consistency
const FILE_DIR_PATH = path.join(__dirname, FILE_DIR);

// ✅ Ensure directory exists
if (!fs.existsSync(FILE_DIR_PATH)) {
  fs.mkdirSync(FILE_DIR_PATH);
}

app.use(express.json());

let isPaused = false;
let pauseUntil = null;

app.use((req, res, next) => {
  const adminPaths = ['/enter-maintenance', '/exit-maintenance', '/status'];
  if (adminPaths.includes(req.path)) return next();

  if (!isPaused) return next();

  const now = new Date();
  if (pauseUntil && now < pauseUntil) {
    return res.json({});
  }

  if (pauseUntil && now >= pauseUntil) {
    isPaused = false;
    pauseUntil = null;
  }

  next();
});

app.get('/', (req, res) => {
  res.send('✅ Local PDF Generator is running.');
});

const headers = {
  accessToken: process.env.ACCESS_TOKEN,
  clientId: process.env.CLIENT_ID,
};
const API_BASE_URL = process.env.API_BASE_URL;
const sanitizeFileName = (str) => str.replace(/[^a-zA-Z0-9-_]/g, '-');

const fetchAndSendPDF = async (res, url, fileId) => {
  try {
    const response = await axios.get(url, { headers });
    const dataArray = response.data?.data;

    if (!dataArray || dataArray.length === 0) {
      return res.json({ fileUrl: 'Payment Advice Document not available' });
    }

    const paymentAdviceLink = dataArray[0]?.paymentAdviceLink;
    if (!paymentAdviceLink || !paymentAdviceLink.includes('base64,')) {
      return res.json({ fileUrl: 'Payment Advice Document not available' });
    }

    const base64PDF = paymentAdviceLink.split('base64,')[1];
    const pdfBuffer = Buffer.from(base64PDF, 'base64');

    const token = crypto.randomBytes(6).toString('hex');
    const safeFileId = sanitizeFileName(fileId);
    const fileName = `payment-advise-${safeFileId}-${token}.pdf`;
    const filePath = path.join(FILE_DIR_PATH, fileName);

    fs.writeFileSync(filePath, pdfBuffer);

    // Delete the file after 10 minutes
    setTimeout(() => {
      fs.unlink(filePath, () => {});
    }, 10 * 60 * 1000);

    // ✅ Change file URL to use /files endpoint
    const fileUrl = `${BASE_FILE_URL}/files/${fileName}`;
    res.json({ fileUrl });
  } catch {
    res.json({ fileUrl: 'Payment Advice Document not available' });
  }
};

app.get('/download-pdf-task', async (req, res) => {
  const { taskId, emailId } = req.query;
  if (!taskId || !emailId) return res.json({ fileUrl: 'Payment Advice Document not available' });

  const encodedTaskId = encodeURIComponent(`$eq:${taskId}`);
  const encodedEmail = encodeURIComponent(emailId);
  const url = `${API_BASE_URL}?sortBy=timeStamp%3AASC&filter.validateKey=Vendor&filter.requiredType=PaymentAdvice&filter.nimbleS2PTaskId=${encodedTaskId}&filter.emailId=${encodedEmail}`;

  await fetchAndSendPDF(res, url, `task-${taskId}`);
});

app.get('/download-pdf-invoice', async (req, res) => {
  const { invoiceNumber, poNumber, emailId } = req.query;
  if (!invoiceNumber || !poNumber || !emailId) {
    return res.json({ fileUrl: 'Payment Advice Document not available' });
  }

  const encodedEmail = encodeURIComponent(emailId);
  const url = `${API_BASE_URL}?filter.validateKey=Vendor&filter.requiredType=PaymentAdvice&filter.invoiceNumber=%24eq%3A${invoiceNumber}&filter.poNumber=%24eq%3A${poNumber}&filter.emailId=${encodedEmail}`;

  await fetchAndSendPDF(res, url, `invpo-${invoiceNumber}-${poNumber}`);
});

app.get('/download-pdf-vendor', async (req, res) => {
  const { invoiceNumber, vendorCode, emailId } = req.query;
  if (!invoiceNumber || !vendorCode || !emailId) {
    return res.json({ fileUrl: 'Payment Advice Document not available' });
  }

  const encodedEmail = encodeURIComponent(emailId);
  const url = `${API_BASE_URL}?filter.validateKey=Vendor&filter.requiredType=PaymentAdvice&filter.invoiceNumber=%24eq%3A${invoiceNumber}&filter.vendorCode=%24eq%3A${vendorCode}&filter.emailId=${encodedEmail}`;

  await fetchAndSendPDF(res, url, `invvendor-${invoiceNumber}-${vendorCode}`);
});

app.post('/enter-maintenance', (req, res) => {
  const { duration, key } = req.body;

  if (!key || key !== MAINTENANCE_KEY) {
    return res.status(403).json({});
  }

  if (!duration || typeof duration !== 'string') {
    return res.status(400).json({});
  }

  if (duration === 'indefinite') {
    isPaused = true;
    pauseUntil = new Date('9999-12-31');
  } else {
    const match = duration.match(/^(\d+)(m|h)$/);
    if (!match) {
      return res.status(400).json({});
    }

    const [_, value, unit] = match;
    const ms = unit === 'm' ? value * 60000 : value * 3600000;
    isPaused = true;
    pauseUntil = new Date(Date.now() + ms);
  }

  res.json({});
});

app.post('/exit-maintenance', (req, res) => {
  const { key } = req.body;

  if (!key || key !== MAINTENANCE_KEY) {
    return res.status(403).json({});
  }

  if (!isPaused) return res.json({});

  isPaused = false;
  pauseUntil = null;
  res.json({});
});

app.get('/status', (req, res) => {
  res.json({
    paused: isPaused,
    pauseUntil,
    currentTime: new Date(),
  });
});

// ✅ NEW: Serve saved files manually from public folder
app.get('/files/:filename', (req, res) => {
  const filePath = path.join(FILE_DIR_PATH, req.params.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('❌ File not found');
  }
  res.sendFile(filePath);
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
