// Updated for Node.js 22.x compatibility
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { createCanvas } = require('canvas');

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

// Initialize PDF.js using legacy CommonJS build and disable worker entirely
let pdfjsLib;
const initPdfJs = async () => {
    if (!pdfjsLib) {
        // eslint-disable-next-line global-require
        pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
        pdfjsLib.GlobalWorkerOptions.workerSrc = '';
        pdfjsLib.GlobalWorkerOptions.workerPort = null;
    }
    return pdfjsLib;
};

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'pdf-converter-service',
        timestamp: new Date().toISOString(),
    });
});

// Convert PDF to PNG using PDF.js + Canvas
async function convertPdfToPng(pdfBuffer, correlationId) {
    console.log(`[${correlationId}] Initializing PDF.js...`);
    const pdfjs = await initPdfJs();
    
    console.log(`[${correlationId}] Loading PDF document...`);
    const loadingTask = pdfjs.getDocument({ 
        data: pdfBuffer,
        // Disable all worker-related features
        useWorkerFetch: false,
        isEvalSupported: false,
        useSystemFonts: true,
        disableWorker: true
    });
    
    const pdf = await loadingTask.promise;
    console.log(`[${correlationId}] PDF loaded, pages: ${pdf.numPages}`);
    
    if (pdf.numPages === 0) {
        throw new Error('PDF has no pages');
    }
    
    // Get first page
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2.0 });
    
    console.log(`[${correlationId}] Creating canvas ${viewport.width}x${viewport.height}...`);
    
    // Create canvas
    const canvas = createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext('2d');
    
    // Fill with white background
    context.fillStyle = 'white';
    context.fillRect(0, 0, viewport.width, viewport.height);
    
    console.log(`[${correlationId}] Rendering PDF page to canvas...`);
    
    // Render PDF page to canvas
    const renderContext = {
        canvasContext: context,
        viewport: viewport,
    };
    
    await page.render(renderContext).promise;
    
    console.log(`[${correlationId}] Converting canvas to PNG buffer...`);
    
    // Convert canvas to PNG buffer
    const pngBuffer = canvas.toBuffer('image/png');
    
    // Cleanup
    await page.cleanup();
    await pdf.destroy();
    
    return pngBuffer;
}

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

        const pngBuffer = await convertPdfToPng(req.file.buffer, correlationId);
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

            const pngBuffer = await convertPdfToPng(req.body, correlationId);
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
