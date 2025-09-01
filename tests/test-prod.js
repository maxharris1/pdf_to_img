const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const BASE_URL = process.env.PDF_SERVICE_URL || 'https://pdf-to-img-sigma.vercel.app';
const SAVE_ARTIFACTS = process.env.SAVE_ARTIFACTS === '1';
const TIMEOUT_MS = Number(process.env.TEST_TIMEOUT_MS || 30000);

function generateCorrelationId(suffix) {
    return `test-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix ? `-${suffix}` : ''}`;
}

function toMs(startHrtime) {
    const diff = process.hrtime(startHrtime);
    return Math.round((diff[0] * 1e9 + diff[1]) / 1e6);
}

async function createPdfBuffer(text = 'Hello PDF!') {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ size: 'LETTER' });
            const chunks = [];
            doc.on('data', (c) => chunks.push(c));
            doc.on('end', () => resolve(Buffer.concat(chunks)));

            doc.fontSize(24).text(text, 72, 72);
            doc.moveDown();
            doc.fontSize(12).text('Automated test document for PDF to PNG service.', { align: 'left' });
            doc.end();
        } catch (err) {
            reject(err);
        }
    });
}

async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        return res;
    } finally {
        clearTimeout(id);
    }
}

async function testHealth() {
    const started = process.hrtime();
    const res = await fetchWithTimeout(`${BASE_URL}/health`, { method: 'GET' });
    const durationMs = toMs(started);
    const body = await res.json();

    if (!res.ok) throw new Error(`Health check failed with status ${res.status}`);
    if (body.status !== 'healthy') throw new Error('Health status not healthy');

    return { name: 'health', ok: true, status: res.status, durationMs, body };
}

async function testConvertMultipart(pdfBuffer) {
    const correlationId = generateCorrelationId('multipart');
    const form = new FormData();
    const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
    form.append('pdf', blob, 'test.pdf');

    const started = process.hrtime();
    const res = await fetchWithTimeout(`${BASE_URL}/convert`, {
        method: 'POST',
        headers: { 'X-Correlation-Id': correlationId },
        body: form,
    });
    const durationMs = toMs(started);

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Multipart convert failed (${res.status}): ${errText}`);
    }

    const buf = Buffer.from(await res.arrayBuffer());

    if (res.headers.get('content-type') !== 'image/png') {
        throw new Error(`Unexpected content-type: ${res.headers.get('content-type')}`);
    }
    if (buf.length === 0) throw new Error('Empty PNG content');

    if (SAVE_ARTIFACTS) {
        const outDir = path.join(__dirname, '..', 'test-artifacts');
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, 'multipart.png'), buf);
    }

    return {
        name: 'convert(multipart)',
        ok: true,
        status: res.status,
        durationMs,
        headers: Object.fromEntries(res.headers.entries()),
        size: buf.length,
        sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    };
}

async function testConvertRaw(pdfBuffer) {
    const correlationId = generateCorrelationId('raw');
    const started = process.hrtime();
    const res = await fetchWithTimeout(`${BASE_URL}/convert-raw`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/pdf',
            'X-Correlation-Id': correlationId,
        },
        body: pdfBuffer,
    });
    const durationMs = toMs(started);

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Raw convert failed (${res.status}): ${errText}`);
    }

    const buf = Buffer.from(await res.arrayBuffer());

    if (res.headers.get('content-type') !== 'image/png') {
        throw new Error(`Unexpected content-type: ${res.headers.get('content-type')}`);
    }
    if (buf.length === 0) throw new Error('Empty PNG content');

    if (SAVE_ARTIFACTS) {
        const outDir = path.join(__dirname, '..', 'test-artifacts');
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, 'raw.png'), buf);
    }

    return {
        name: 'convert-raw',
        ok: true,
        status: res.status,
        durationMs,
        headers: Object.fromEntries(res.headers.entries()),
        size: buf.length,
        sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    };
}

async function testConvertMissingFile() {
    const form = new FormData();
    const res = await fetchWithTimeout(`${BASE_URL}/convert`, { method: 'POST', body: form });
    const body = await res.json().catch(() => ({}));
    const ok = res.status === 400 && body && body.error;
    if (!ok) throw new Error(`Expected 400 for missing file, got ${res.status}`);
    return { name: 'convert(missing file)', ok: true, status: res.status, body };
}

async function testConvertRawInvalidContent() {
    const correlationId = generateCorrelationId('invalid');
    const res = await fetchWithTimeout(`${BASE_URL}/convert-raw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/pdf', 'X-Correlation-Id': correlationId },
        body: Buffer.from('not-a-pdf'),
    });
    const body = await res.json().catch(() => ({}));
    const ok = (res.status === 500 || res.status === 400) && body && body.error;
    if (!ok) throw new Error(`Expected error for invalid PDF content, got ${res.status}`);
    return { name: 'convert-raw(invalid content)', ok: true, status: res.status, body };
}

async function runConcurrency(pdfBuffer, requests = 3) {
    const started = process.hrtime();
    const results = await Promise.all(
        Array.from({ length: requests }, () => testConvertRaw(pdfBuffer)),
    );
    const durationMs = toMs(started);
    const avg = Math.round(results.reduce((s, r) => s + r.durationMs, 0) / results.length);
    return { name: 'concurrency(raw x' + requests + ')', ok: true, totalDurationMs: durationMs, averageMs: avg };
}

async function main() {
    const started = Date.now();
    const report = { baseUrl: BASE_URL, startedAt: new Date(started).toISOString(), results: [], success: true };
    try {
        const pdf = await createPdfBuffer('PDF to PNG automated test');

        // Core tests
        report.results.push(await testHealth());
        const m = await testConvertMultipart(pdf);
        const r = await testConvertRaw(pdf);
        report.results.push(m, r);

        // Ensure equal output for same input across endpoints
        if (m.sha256 !== r.sha256) {
            throw new Error('Mismatch between multipart and raw conversion outputs (sha256 differ)');
        }

        // Negative cases
        report.results.push(await testConvertMissingFile());
        report.results.push(await testConvertRawInvalidContent());

        // Concurrency
        report.results.push(await runConcurrency(pdf, 3));

        report.durationMs = Date.now() - started;
    } catch (err) {
        report.success = false;
        report.error = err && (err.stack || err.message || String(err));
    }

    const outDir = path.join(__dirname, '..', 'test-results');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `prod-results-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

    // Console summary
    /* eslint-disable no-console */
    console.log('--- PDF Converter Service Prod Test ---');
    console.log('Base URL:', report.baseUrl);
    if (report.success) {
        console.log('STATUS: PASS');
        report.results.forEach((r) => console.log(r.name, '->', JSON.stringify(r)));
    } else {
        console.error('STATUS: FAIL');
        console.error(report.error);
        process.exitCode = 1;
    }
    console.log('Results JSON:', outPath);
}

main();


