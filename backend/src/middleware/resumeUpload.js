const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = path.join(__dirname, '../../uploads/resumes');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
        cb(null, unique + path.extname(file.originalname));
    }
});

const fileFilter = (_req, file, cb) => {
    // 1. Strictly validate MIME type
    const allowedMimeTypes = [
        'application/pdf',
        'application/msword', // .doc
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' // .docx
    ];

    if (!allowedMimeTypes.includes(file.mimetype)) {
        return cb(new Error('Invalid file type. Only PDF, DOC, and DOCX files are allowed.'), false);
    }

    // 2. Validate file extension
    const allowedExtensions = ['.pdf', '.doc', '.docx'];
    const ext = path.extname(file.originalname).toLowerCase();

    if (!allowedExtensions.includes(ext)) {
        return cb(new Error('Invalid file extension.'), false);
    }

    cb(null, true);
};

const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

const validateFileType = async (req, res, next) => {
    if (!req.file) return next();

    // Securely resolve the path to prevent CodeQL path traversal alerts
    const safePath = path.join(uploadDir, path.basename(req.file.filename));

    try {
        const fileType = await import('file-type');
        const type = await fileType.fileTypeFromFile(safePath);

        const allowedMimeTypes = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ];

        if (!type || !allowedMimeTypes.includes(type.mime)) {
            if (fs.existsSync(safePath)) fs.unlinkSync(safePath); // Delete invalid file
            return res.status(400).json({ message: 'Invalid file type. Only true PDF, DOC, DOCX files are allowed.' });
        }

        next();
    } catch (err) {
        if (req.file && fs.existsSync(safePath)) fs.unlinkSync(safePath);
        return res.status(500).json({ message: 'Error validating file type' });
    }
};

const originalSingle = upload.single.bind(upload);
upload.single = (field) => [originalSingle(field), validateFileType];

module.exports = upload;
