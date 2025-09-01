// Updated for Node.js 22.x compatibility
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { pdfToPng } = require('pdf-to-png-converter');

const app = express();
const port = process.env.PORT || 3000;

// Enable CORS for all routes
app.use(cors());

// Configure multer for handling binary data
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
    },
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'pdf-converter-service',
        timestamp: new Date().toISOString(),
    });
});

// Main conversion endpoint
app.post('/convert', upload.single('pdf'), async (req, res) => {
    const startTime = Date.now();
    const correlationId = req.headers['x-correlation-id'] || 'unknown';

    try {
        console.log(`[${correlationId}] PDF conversion request received, size: ${req.file?.buffer?.length || 0} bytes`);

        if (!req.file || !req.file.buffer) {
            return res.status(400).json({
                error: 'No PDF file provided',
                correlationId,
            });
        }

        // Convert PDF to PNG (first page only)
        console.log(`[${correlationId}] Starting PDF to PNG conversion...`);
        const pngPages = await pdfToPng(req.file.buffer, {
            disableFontFace: false,
            useSystemFonts: false,
            enableXfa: false,
            viewportScale: 2.0,
            outputFilesFolder: undefined, // Keep in memory
            outputFolder: undefined,
            pagesRange: [1], // First page only
            strictPaging: false,
        });

        if (!pngPages || pngPages.length === 0) {
            throw new Error('No pages converted from PDF');
        }

        const pngBuffer = pngPages[0].content;
        const processingTime = Date.now() - startTime;

        console.log(
            `[${correlationId}] Conversion successful: ${req.file.buffer.length} bytes PDF -> ${pngBuffer.length} bytes PNG in ${processingTime}ms`,
        );

        // Return PNG as binary data
        res.set({
            'Content-Type': 'image/png',
            'Content-Length': pngBuffer.length,
            'X-Processing-Time-Ms': processingTime.toString(),
            'X-Correlation-Id': correlationId,
            'X-Original-Size': req.file.buffer.length.toString(),
            'X-Converted-Size': pngBuffer.length.toString(),
        });

        res.send(pngBuffer);
    } catch (error) {
        const processingTime = Date.now() - startTime;
        const errorMessage = error.message || 'Unknown conversion error';

        console.error(`[${correlationId}] Conversion failed after ${processingTime}ms:`, errorMessage);

        res.status(500).json({
            error: 'PDF conversion failed',
            message: errorMessage,
            correlationId,
            processingTimeMs: processingTime,
        });
    }
});

// Alternative endpoint that accepts raw binary in request body
app.post(
    '/convert-raw',
    express.raw({
        type: 'application/pdf',
        limit: '10mb',
    }),
    async (req, res) => {
        const startTime = Date.now();
        const correlationId = req.headers['x-correlation-id'] || 'unknown';

        try {
            console.log(`[${correlationId}] Raw PDF conversion request received, size: ${req.body?.length || 0} bytes`);

            if (!req.body || req.body.length === 0) {
                return res.status(400).json({
                    error: 'No PDF data provided',
                    correlationId,
                });
            }

            // Convert PDF to PNG (first page only)
            console.log(`[${correlationId}] Starting raw PDF to PNG conversion...`);
            const pngPages = await pdfToPng(req.body, {
                disableFontFace: false,
                useSystemFonts: false,
                enableXfa: false,
                viewportScale: 2.0,
                outputFilesFolder: undefined, // Keep in memory
                outputFolder: undefined,
                pagesRange: [1], // First page only
                strictPaging: false,
            });

            if (!pngPages || pngPages.length === 0) {
                throw new Error('No pages converted from PDF');
            }

            const pngBuffer = pngPages[0].content;
            const processingTime = Date.now() - startTime;

            console.log(
                `[${correlationId}] Raw conversion successful: ${req.body.length} bytes PDF -> ${pngBuffer.length} bytes PNG in ${processingTime}ms`,
            );

            // Return PNG as binary data
            res.set({
                'Content-Type': 'image/png',
                'Content-Length': pngBuffer.length,
                'X-Processing-Time-Ms': processingTime.toString(),
                'X-Correlation-Id': correlationId,
                'X-Original-Size': req.body.length.toString(),
                'X-Converted-Size': pngBuffer.length.toString(),
            });

            res.send(pngBuffer);
        } catch (error) {
            const processingTime = Date.now() - startTime;
            const errorMessage = error.message || 'Unknown conversion error';

            console.error(`[${correlationId}] Raw conversion failed after ${processingTime}ms:`, errorMessage);

            res.status(500).json({
                error: 'PDF conversion failed',
                message: errorMessage,
                correlationId,
                processingTimeMs: processingTime,
            });
        }
    },
);

// Start server
app.listen(port, () => {
    console.log(`PDF Converter Service running on port ${port}`);
    console.log(`Health check: http://localhost:${port}/health`);
    console.log(`Convert endpoint: POST http://localhost:${port}/convert`);
    console.log(`Raw convert endpoint: POST http://localhost:${port}/convert-raw`);
});
