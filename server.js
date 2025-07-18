require('dotenv').config();

const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const API_BASE_URL = process.env.API_BASE_URL;
const headers = {
  accessToken: process.env.ACCESS_TOKEN,
  clientId: process.env.CLIENT_ID,
};

app.get('/', (req, res) => {
  res.send('✅ JSPL PDF microservice is running.');
});

// Utility to fetch PDF from base64 API and send as file
const fetchAndStreamPDF = async (res, url, fileId) => {
  try {
    const apiRes = await axios.get(url, { headers });
    const dataArray = apiRes.data?.data;

    if (!dataArray || dataArray.length === 0) {
      return res.status(404).json({ error: 'Payment Advice Document not available' });
    }

    const base64PDF = dataArray[0]?.paymentAdviceLink?.split('base64,')[1];
    if (!base64PDF) {
      return res.status(404).json({ error: 'Payment Advice Document not available' });
    }

    const buffer = Buffer.from(base64PDF, 'base64');
    const fileName = `${fileId}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    res.send(buffer);

  } catch (err) {
    console.error('PDF Error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
};

app.get('/download-pdf-task', async (req, res) => {
  const { taskId, emailId } = req.query;
  if (!taskId || !emailId) return res.status(400).json({ error: 'Missing taskId or emailId' });

  const encodedTaskId = encodeURIComponent(`$eq:${taskId}`);
  const encodedEmail = encodeURIComponent(emailId);
  const url = `${API_BASE_URL}?sortBy=timeStamp%3AASC&filter.validateKey=Vendor&filter.requiredType=PaymentAdvice&filter.nimbleS2PTaskId=${encodedTaskId}&filter.emailId=${encodedEmail}`;

  await fetchAndStreamPDF(res, url, `task-${taskId}`);
});

app.get('/download-pdf-invoice', async (req, res) => {
  const { invoiceNumber, poNumber, emailId } = req.query;
  if (!invoiceNumber || !poNumber || !emailId) return res.status(400).json({ error: 'Missing params' });

  const encodedEmail = encodeURIComponent(emailId);
  const url = `${API_BASE_URL}?filter.validateKey=Vendor&filter.requiredType=PaymentAdvice&filter.invoiceNumber=%24eq%3A${invoiceNumber}&filter.poNumber=%24eq%3A${poNumber}&filter.emailId=${encodedEmail}`;

  await fetchAndStreamPDF(res, url, `invpo-${invoiceNumber}-${poNumber}`);
});

app.get('/download-pdf-vendor', async (req, res) => {
  const { invoiceNumber, vendorCode, emailId } = req.query;
  if (!invoiceNumber || !vendorCode || !emailId) return res.status(400).json({ error: 'Missing params' });

  const encodedEmail = encodeURIComponent(emailId);
  const url = `${API_BASE_URL}?filter.validateKey=Vendor&filter.requiredType=PaymentAdvice&filter.invoiceNumber=%24eq%3A${invoiceNumber}&filter.vendorCode=%24eq%3A${vendorCode}&filter.emailId=${encodedEmail}`;

  await fetchAndStreamPDF(res, url, `invvendor-${invoiceNumber}-${vendorCode}`);
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
