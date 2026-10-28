const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const db = require('../models/database');
const { uploadLimiter, authLimiter } = require('../middleware/rateLimiting');
const { authenticateToken } = require('../middleware/auth');
const { validateValidatorApplication } = require('../middleware/validation');

const router = express.Router();
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

const upload = multer({
  dest: path.join(process.cwd(), 'uploads'),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1
  },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error('Unsupported file type'));
  }
});

function getSignSecret() {
  const secret = process.env.SIGN_SECRET;
  if (!secret) {
    throw new Error('SIGN_SECRET is not configured');
  }
  return secret;
}

function signaturesMatch(expected, actual) {
  const expectedBuf = Buffer.from(String(expected), 'utf8');
  const actualBuf = Buffer.from(String(actual), 'utf8');
  if (expectedBuf.length !== actualBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}
function parsePagination(page, limit) {
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  return { pageNum, limitNum };
}

router.get('/', (req, res) => {
  try {
    const {
      expertise,
      jurisdiction,
      availability,
      searchTerm,
      page = 1,
      limit = 20
    } = req.query;

    const filters = {};
    if (expertise) filters.expertise = expertise;
    if (jurisdiction) filters.jurisdiction = jurisdiction;
    if (availability !== undefined) filters.availability = availability === 'true';

    let validators = db.getAllValidators(filters); 
    db.log("validator routes", validators.length);

    if (searchTerm) {
      const term = String(searchTerm).toLowerCase();
      validators = validators.filter((validator) =>
        (validator.name || '').toLowerCase().includes(term) ||
        (validator.jurisdiction || '').toLowerCase().includes(term)
      );
    }

    const { pageNum, limitNum } = parsePagination(page, limit);
    const startIndex = (pageNum - 1) * limitNum;
    const paginatedValidators = validators.slice(startIndex, startIndex + limitNum);
    res.json({
      validators: paginatedValidators,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(validators.length / limitNum) || 1,
        totalItems: validators.length,
        itemsPerPage: limitNum
      }
    });
  } catch (error) {
    console.error('Error fetching validators:', error);
    res.status(500).json({ error: 'Failed to fetch validators' });
  }
});

router.post('/apply', authLimiter, validateValidatorApplication, (req, res) => {
  try {
    const application = db.createValidatorApplication(req.body);

    res.status(201).json({
      applicationId: application.id,
      status: application.status,
      message: 'Application submitted successfully. You will be notified once reviewed.'
    });
  } catch (error) {
    console.error('Error submitting validator application:', error);
    res.status(500).json({ error: 'Failed to submit validator application' });
  }
});

router.get('/applications/:applicationId', (req, res) => {
  try {
    const application = db.getValidatorApplicationById(req.params.applicationId);
    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    res.json({
      applicationId: application.id,
      status: application.status,
      feedback: application.feedback,
      nextSteps: application.nextSteps
    });
  } catch (error) {
    console.error('Error fetching application status:', error);
    res.status(500).json({ error: 'Failed to fetch application status' });
  }
});

router.post('/verify', authenticateToken, uploadLimiter, upload.single('file'), (req, res) => {
  const uploadedPath = req.file && req.file.path;

  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'File is required' });
    }

    const assetId = req.body.assetId;
    if (!assetId || !SAFE_ID.test(assetId)) {
      return res.status(400).json({ success: false, error: 'Valid assetId is required' });
    }

    const asset = db.getAssetById(assetId);
    if (!asset) {
      return res.status(404).json({ success: false, error: 'Asset not found' });
    }

    const result = validateSign(req.file.path, getSignSecret());
    const storedSignature = db.getSign(asset.id);

    if (storedSignature) {
      const matches = signaturesMatch(storedSignature, result.signature);
      return res.json({
        success: matches,
        assetId: asset.id,
        verified: matches
      });
    }
    db.sign({
      signBuffer: Buffer.from(result.signature, 'utf8'),
      signInfo: `${asset.id}.sig`
    });

    res.json({
      success: true,
      assetId: asset.id,
      verified: true
    });
  } catch (error) {
    console.error('Verification failed:', error);
    const status = error.message === 'Unsupported file type' ? 400 : 500;
    res.status(status).json({
      success: false,
      error: status === 400 ? error.message : 'Verification failed'
    });
  } finally {
    if (uploadedPath) {
      fs.unlink(uploadedPath, () => {});
    }
  }
});

router.get('/:id', (req, res) => {
  try {
    const validator = db.getValidatorById(req.params.id);
    if (!validator) {
      return res.status(404).json({ error: 'Validator not found' });
    }
    res.json(validator);
  } catch (error) {
    console.error('Error fetching validator:', error);
    res.status(500).json({ error: 'Failed to fetch validator' });
  }
});

router.get('/:id/history', (req, res) => {
  try {
    const validator = db.getValidatorById(req.params.id);
    if (!validator) {
      return res.status(404).json({ error: 'Validator not found' });
    }

    const history = db.getValidatorHistory(req.params.id);
    res.json(history);
  } catch (error) {
    console.error('Error fetching validator history:', error);
    res.status(500).json({ error: 'Failed to fetch validator history' });
  }
});

router.get('/:id/availability', (req, res) => {
  try {
    const validator = db.getValidatorById(req.params.id);
    if (!validator) {
      return res.status(404).json({ error: 'Validator not found' });
    }

    res.json({
      available: validator.availability,
      nextAvailableSlot: validator.availability
        ? null
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    });
  } catch (error) {
    console.error('Error fetching validator availability:', error);
    res.status(500).json({ error: 'Failed to fetch validator availability' });
  }
});

router.get('/:id/fees', (req, res) => {
  try {
    const { category } = req.query;
    const validator = db.getValidatorById(req.params.id);

    if (!validator) {
      return res.status(404).json({ error: 'Validator not found' });
    }

    if (!category) {
      return res.status(400).json({ error: 'Category parameter is required' });
    }

    if (!Array.isArray(validator.expertise) || !validator.expertise.includes(category)) {
      return res.status(400).json({ error: 'Validator does not have expertise in this category' });
    }

    res.json({
      amount: validator.verificationFee.amount,
      currency: validator.verificationFee.currency,
      estimatedTime: validator.responseTime
    });
  } catch (error) {
    console.error('Error fetching validator fees:', error);
    res.status(500).json({ error: 'Failed to fetch validator fees' });
  }
});

module.exports = router;
