require('dotenv').config();

const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_FILE_URL = process.env.PUBLIC_FILE_HOST;
const MAINTENANCE_KEY = process.env.MAINTENANCE_KEY;
const MONGO_URI = process.env.MONGO_URI;

app.use(express.json());

let isPaused = false;
let pauseUntil = null;

const headers = {
  accessToken: process.env.ACCESS_TOKEN,
  clientId: process.env.CLIENT_ID,
};

const API_BASE_URL = process.env.API_BASE_URL;
const sanitizeFileName = (str) => str.replace(/[^a-zA-Z0-9-_]/g, '-');

const client = new MongoClient(MONGO_URI);
let pdfCollection;

async function initMongo() {
  await client.connect();
  const db = client.db('pdfdb');
  pdfCollection = db.collection('pdfs');
}
initMongo();

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
  res.send('✅ PDF MongoDB Storage Service is running.');
});

const fetchAndStorePDF = async (res, url, fileId) => {
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

    const token = crypto.randomBytes(8).toString('hex');
    const safeFileId = sanitizeFileName(fileId);

    // Store in MongoDB
    await pdfCollection.insertOne({
      token,
      name: `payment-${safeFileId}.pdf`,
      buffer: pdfBuffer,
      createdAt: new Date(),
    });

    const fileUrl = `${BASE_FILE_URL}/pdf/${token}`;
    res.json({ fileUrl });
  } catch (err) {
    console.error(err);
    res.json({ fileUrl: 'Payment Advice Document not available' });
  }
};

// Task-based
app.get('/download-pdf-task', async (req, res) => {
  const { taskId, emailId } = req.query;
  if (!taskId || !emailId) return res.json({ fileUrl: 'Payment Advice Document not available' });

  const encodedTaskId = encodeURIComponent(`$eq:${taskId}`);
  const encodedEmail = encodeURIComponent(emailId);
  const url = `${API_BASE_URL}?sortBy=timeStamp%3AASC&filter.validateKey=Vendor&filter.requiredType=PaymentAdvice&filter.nimbleS2PTaskId=${encodedTaskId}&filter.emailId=${encodedEmail}`;

  await fetchAndStorePDF(res, url, `task-${taskId}`);
});

// Invoice + PO
app.get('/download-pdf-invoice', async (req, res) => {
  const { invoiceNumber, poNumber, emailId } = req.query;
  if (!invoiceNumber || !poNumber || !emailId) return res.json({ fileUrl: 'Payment Advice Document not available' });

  const encodedEmail = encodeURIComponent(emailId);
  const url = `${API_BASE_URL}?filter.validateKey=Vendor&filter.requiredType=PaymentAdvice&filter.invoiceNumber=%24eq%3A${invoiceNumber}&filter.poNumber=%24eq%3A${poNumber}&filter.emailId=${encodedEmail}`;

  await fetchAndStorePDF(res, url, `invpo-${invoiceNumber}-${poNumber}`);
});

// Invoice + Vendor
app.get('/download-pdf-vendor', async (req, res) => {
  const { invoiceNumber, vendorCode, emailId } = req.query;
  if (!invoiceNumber || !vendorCode || !emailId) return res.json({ fileUrl: 'Payment Advice Document not available' });

  const encodedEmail = encodeURIComponent(emailId);
  const url = `${API_BASE_URL}?filter.validateKey=Vendor&filter.requiredType=PaymentAdvice&filter.invoiceNumber=%24eq%3A${invoiceNumber}&filter.vendorCode=%24eq%3A${vendorCode}&filter.emailId=${encodedEmail}`;

  await fetchAndStorePDF(res, url, `invvendor-${invoiceNumber}-${vendorCode}`);
});

// Only PO
app.get('/download-pdf-po', async (req, res) => {
  const { poNumber, emailId } = req.query;
  if (!poNumber || !emailId) return res.json({ fileUrl: 'Payment Advice Document not available' });

  const encodedEmail = encodeURIComponent(emailId);
  const url = `${API_BASE_URL}?filter.validateKey=Vendor&filter.requiredType=PaymentAdvice&filter.poNumber=%24eq%3A${poNumber}&filter.emailId=${encodedEmail}`;

  await fetchAndStorePDF(res, url, `po-${poNumber}`);
});

// Only GRN
app.get('/download-pdf-grn', async (req, res) => {
  const { grnNumber, emailId } = req.query;
  if (!grnNumber || !emailId) return res.json({ fileUrl: 'Payment Advice Document not available' });

  const encodedEmail = encodeURIComponent(emailId);
  const url = `${API_BASE_URL}?filter.validateKey=Vendor&filter.requiredType=PaymentAdvice&filter.grnNumber=%24eq%3A${grnNumber}&filter.emailId=${encodedEmail}`;

  await fetchAndStorePDF(res, url, `grn-${grnNumber}`);
});

// Serve stored PDF
app.get('/pdf/:token', async (req, res) => {
  const { token } = req.params;
  const doc = await pdfCollection.findOne({ token });

  if (!doc) return res.status(404).send('Not found');

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${doc.name}"`);
  res.send(doc.buffer.buffer); // BSON Binary
});

// Maintenance controls
app.post('/enter-maintenance', (req, res) => {
  const { duration, key } = req.body;
  if (!key || key !== MAINTENANCE_KEY) return res.status(403).json({});
  if (!duration || typeof duration !== 'string') return res.status(400).json({});

  if (duration === 'indefinite') {
    isPaused = true;
    pauseUntil = new Date('9999-12-31');
  } else {
    const match = duration.match(/^([0-9]+)(m|h)$/);
    if (!match) return res.status(400).json({});
    const [_, value, unit] = match;
    const ms = unit === 'm' ? value * 60000 : value * 3600000;
    isPaused = true;
    pauseUntil = new Date(Date.now() + ms);
  }

  res.json({});
});

app.post('/exit-maintenance', (req, res) => {
  const { key } = req.body;
  if (!key || key !== MAINTENANCE_KEY) return res.status(403).json({});
  isPaused = false;
  pauseUntil = null;
  res.json({});
});

app.get('/status', (req, res) => {
  res.json({ paused: isPaused, pauseUntil, currentTime: new Date() });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
