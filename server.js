require('dotenv').config();

const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const FormData = require('form-data');

const app = express();
const PORT = process.env.PORT || 3000;

const API_BASE_URL = process.env.API_BASE_URL;
const headers = {
  accessToken: process.env.ACCESS_TOKEN,
  clientId: process.env.CLIENT_ID,
};

// Utility: Upload to transfer.sh and return public link
async function uploadToTransferSh(buffer, filename) {
  const form = new FormData();
  form.append('file', buffer, filename);

  const uploadUrl = `https://transfer.sh/${filename}`;
  const uploadRes = await axios.post(uploadUrl, form, {
    headers: form.getHeaders()
  });

  return uploadRes.data; // This will be the public link
}

// Utility: Fetch PDF from base64 and upload it
const fetchAndUploadPDF = async (url, fileId, res) => {
  try {
    const apiRes = await axios.get(url, { headers });
    const dataArray = apiRes.data?.data;

    if (!dataArray || dataArray.length === 0) {
      return res.status(404).json({ error: 'Payment Advice not found' });
    }

    const base64PDF = dataArray[0]?.paymentAdviceLink?.split('base64,')[1];
    if (!base64PDF) {
      return res.status(404).json({ error: 'Invalid PDF data' });
    }

    const buffer = Buffer.from(base64PDF, 'base64');
    const fileName = `${fileId}-${Date.now()}.pdf`;

    const publicLink = await uploadToTransferSh(buffer, fileName);

    return res.json({ link: publicLink });
  } catch (err) {
    console.error('Error uploading PDF:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

app.get('/', (req, res) => {
  res.send('✅ JSPL Transfer PDF microservice is running.');
});

app.get('/download-pdf-task', async (req, res) => {
  const { taskId, emailId } = req.query;
  if (!taskId || !emailId) return res.status(400).json({ error: 'Missing taskId or emailId' });

  const encodedTaskId = encodeURIComponent(`$eq:${taskId}`);
  const encodedEmail = encodeURIComponent(emailId);
  const url = `${API_BASE_URL}?sortBy=timeStamp%3AASC&filter.validateKey=Vendor&filter.requiredType=PaymentAdvice&filter.nimbleS2PTaskId=${encodedTaskId}&filter.emailId=${encodedEmail}`;

  await fetchAndUploadPDF(url, `task-${taskId}`, res);
});

app.get('/download-pdf-invoice', async (req, res) => {
  const { invoiceNumber, poNumber, emailId } = req.query;
  if (!invoiceNumber || !poNumber || !emailId) return res.status(400).json({ error: 'Missing parameters' });

  const encodedEmail = encodeURIComponent(emailId);
  const url = `${API_BASE_URL}?filter.validateKey=Vendor&filter.requiredType=PaymentAdvice&filter.invoiceNumber=%24eq%3A${invoiceNumber}&filter.poNumber=%24eq%3A${poNumber}&filter.emailId=${encodedEmail}`;

  await fetchAndUploadPDF(url, `invpo-${invoiceNumber}-${poNumber}`, res);
});

app.get('/download-pdf-vendor', async (req, res) => {
  const { invoiceNumber, vendorCode, emailId } = req.query;
  if (!invoiceNumber || !vendorCode || !emailId) return res.status(400).json({ error: 'Missing parameters' });

  const encodedEmail = encodeURIComponent(emailId);
  const url = `${API_BASE_URL}?filter.validateKey=Vendor&filter.requiredType=PaymentAdvice&filter.invoiceNumber=%24eq%3A${invoiceNumber}&filter.vendorCode=%24eq%3A${vendorCode}&filter.emailId=${encodedEmail}`;

  await fetchAndUploadPDF(url, `invvendor-${invoiceNumber}-${vendorCode}`, res);
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
