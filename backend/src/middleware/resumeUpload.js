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
    const allowed = ['.pdf', '.doc', '.docx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only PDF, DOC, DOCX files are allowed'), false);
};

const upload = multer({ storage, fileFilter, limits: { fileSize: 5 * 1024 * 1024 } });

const validateFileType = async (req, res, next) => {
    if (!req.file) return next();

    try {
        const fileType = await import('file-type');
        const type = await fileType.fileTypeFromFile(req.file.path);
        
        const allowedMimeTypes = [
            'application/pdf', 
            'application/msword', 
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ];

        if (!type || !allowedMimeTypes.includes(type.mime)) {
            fs.unlinkSync(req.file.path); // Delete invalid file
            return res.status(400).json({ message: 'Invalid file type. Only true PDF, DOC, DOCX files are allowed.' });
        }
        
        next();
    } catch (err) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(500).json({ message: 'Error validating file type' });
    }
};

module.exports = {
    single: (field) => [upload.single(field), validateFileType]
};
