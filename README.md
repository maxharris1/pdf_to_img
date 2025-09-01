# PDF Converter Service

A fast, lightweight microservice for converting PDF files to PNG images. Designed specifically for the NSA Case Navigator document parsing pipeline.

## Features

- ⚡ **Fast conversion**: PDF to PNG in ~1-3 seconds
- 🎯 **First page only**: Optimized for single-page documents
- 📏 **High quality**: 2x viewport scale for excellent OCR results
- 🔒 **Secure**: No file storage, all processing in memory
- 📊 **Monitoring**: Built-in correlation ID tracking and performance metrics
- 🌐 **CORS enabled**: Ready for cross-origin requests

## API Endpoints

### Health Check

```
GET /health
```

### Convert PDF (Multipart Form)

```
POST /convert
Content-Type: multipart/form-data

Form field: pdf (file)
Headers: X-Correlation-Id (optional)
```

### Convert PDF (Raw Binary)

```
POST /convert-raw
Content-Type: application/pdf
Headers: X-Correlation-Id (optional)

Body: PDF binary data
```

## Response

**Success (200):**

```
Content-Type: image/png
X-Processing-Time-Ms: 1234
X-Correlation-Id: abc-123
X-Original-Size: 204800
X-Converted-Size: 512000

[PNG binary data]
```

**Error (400/500):**

```json
{
    "error": "PDF conversion failed",
    "message": "Detailed error message",
    "correlationId": "abc-123",
    "processingTimeMs": 1234
}
```

## Usage in Edge Functions

```typescript
// Convert small PDF to PNG
const response = await fetch('https://your-service.vercel.app/convert-raw', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/pdf',
        'X-Correlation-Id': correlationId,
    },
    body: pdfData,
});

if (response.ok) {
    const pngData = new Uint8Array(await response.arrayBuffer());
    // Use pngData with Textract sync API
} else {
    // Fallback to async processing
}
```

## Local Development

```bash
npm install
npm start
```

## Deployment

This service is configured for automatic deployment to Vercel via GitHub integration.

## Performance

- **Processing time**: 1-3 seconds for typical documents
- **Memory usage**: ~50MB per conversion
- **Throughput**: 10-20 conversions per second
- **File size limit**: 10MB

## Security

- No file persistence
- Memory-only processing
- CORS enabled for controlled access
- Request size limits
- Error message sanitization
