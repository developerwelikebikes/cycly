// server.js
// HTTP service to fetch vehicles from Cycly, filter them and return a CSV for Shopify.

import express from 'express';
import morgan from 'morgan';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

// Base configuration
const PORT = process.env.PORT || 4100;
const CYCLY_BASE_URL = 'https://welikebikes.cycly.cloud/rest/extension';
const CYCLY_TOKEN = process.env.CYCLY_TOKEN; // do NOT hardcode the token
const VEHICLES_ENDPOINT = `${CYCLY_BASE_URL}/vehicles/branch/1`;

/**
 * Escape a value so it is safe inside a CSV cell.
 * - Wraps value in double quotes if it contains comma, quote or newline.
 * - Doubles internal double quotes according to CSV rules.
 */
function csvEscape(value) {
    if (value === undefined || value === null) return '';
    const str = String(value);
    if (/[",\n\r]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

/**
 * Fetch vehicles from Cycly, filter them and build the CSV content.
 */
async function generateCsv() {
    if (!CYCLY_TOKEN) {
        throw new Error('Missing CYCLY_TOKEN environment variable');
    }

    const startedAt = new Date();
    console.log(`[${startedAt.toISOString()}] Starting Cycly fetch from ${VEHICLES_ENDPOINT}`);

    const res = await axios.get(VEHICLES_ENDPOINT, {
        headers: {
            Authorization: `Bearer ${CYCLY_TOKEN}`,
            Accept: 'application/json',
        },
        timeout: 15000, // 15s timeout to avoid hanging requests
    });

    const rawData = res.data;

    // Cycly returns an object keyed by ID: {"251": {...}, ...}
    const vehicles = Array.isArray(rawData) ? rawData : Object.values(rawData);
    console.log(`[${new Date().toISOString()}] Fetched ${vehicles.length} vehicles from Cycly`);

    // Filter only Neufahrzeug with state Fertig montiert or Angeliefert
    const filtered = vehicles.filter((v) => {
        const isNewBike = v.type === 'Neufahrzeug';
        const isCorrectState =
            v.state === 'Fertig montiert' || v.state === 'Angeliefert';
        return isNewBike && isCorrectState;
    });

    console.log(
        `[${new Date().toISOString()}] Vehicles after filtering (Neufahrzeug + Fertig montiert / Angeliefert): ${filtered.length}`
    );

    const rows = filtered.map((v) => ({
        ID: v.id,
        gtin: v.ean,
        model: v.model,
        brand: v.manufacturer,
        mpn: v.mpn,
        sku: v.sku,
        color: v.color,
        frameSize: v.frameSizeFormated,
        frameSizeNumeric: v.frameSize,
        Lager: '1', // always "1"
        price: v.price,
        retailPrice: v.discountPrice ?? v.price, // use price when discountPrice is null
    }));

    const headers = [
        'ID',
        'gtin',
        'model',
        'brand',
        'mpn',
        'sku',
        'color',
        'frameSize',
        'frameSizeNumeric',
        'Lager',
        'price',
        'retailPrice',
    ];

    const lines = [];
    lines.push(headers.join(','));

    for (const row of rows) {
        const line = headers.map((h) => csvEscape(row[h])).join(',');
        lines.push(line);
    }

    const csvContent = lines.join('\n');

    console.log(
        `[${new Date().toISOString()}] CSV built successfully (lines: ${lines.length})`
    );

    return csvContent;
}

// HTTP logging middleware
app.use(morgan('combined'));

/**
 * Health check endpoint.
 */
app.get('/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

/**
 * Main endpoint: returns CSV.
 * Example: GET /cycly/export
 */
app.get('/cycly/export/bikeexchange', async (req, res) => {
    const requestTime = new Date();
    console.log(
        `[${requestTime.toISOString()}] /cycly/export requested from ${req.ip}`
    );

    try {
        const csvContent = await generateCsv();

        const filename = `cycly_vehicles_${requestTime
            .toISOString()
            .slice(0, 10)}.csv`;

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        return res.status(200).send(csvContent);
    } catch (err) {
        console.error(
            `[${new Date().toISOString()}] Error in /cycly/export:`,
            err.message
        );
        return res.status(500).json({
            error: 'Failed to generate CSV',
            message: err.message,
        });
    }
});

app.listen(PORT, () => {
    console.log(
        `[${new Date().toISOString()}] Cycly export service listening on port ${PORT}`
    );
});
