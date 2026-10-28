const express = require('express');
const router = express.Router();
const db = require('../models/database');
const { validateAssetUpdate } = require('../middleware/validation');
const { authenticateToken, optionalAuth } = require('../middleware/auth');
const { testConfig } = require('../config');

// Get all assets with optional filters
router.get('/', (req, res) => {
  try {
    const {
      category,
      status,
      verified,
      priceRange,
      searchTerm,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const filters = {};
    if (category) filters.category = category;
    if (status) filters.status = status;
    if (verified !== undefined) filters.verified = verified === 'true';
    if (priceRange) {
      const [min, max] = priceRange.split('-').map(Number);
      filters.priceRange = { min, max };
    }
    if (searchTerm) filters.searchTerm = searchTerm;

    let assets = db.getValidatedAssets(filters);
    // Sort assets
    assets.sort((a, b) => {
      let aValue = a[sortBy];
      let bValue = b[sortBy];
      
      if (sortBy === 'price') {
        aValue = a.price.amount;
        bValue = b.price.amount;
      }
      
      if (sortOrder === 'asc') {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });

    // Pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedAssets = assets.slice(startIndex, endIndex);
    
    res.json({
      assets: paginatedAssets,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(assets.length / limit),
        totalItems: assets.length,
        itemsPerPage: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Error fetching assets:', error);
    res.status(500).json({ error: 'Failed to fetch assets' });
  }
});

// Get asset by ID
router.get('/:id', (req, res) => {
  try {
    const asset = db.getAssetById(req.params.id);
    if (!asset) {
      return res.status(404).json({ error: 'Asset not found' });
    }
    res.json(asset);
  } catch (error) {
    console.error('Error fetching asset:', error);
    res.status(500).json({ error: 'Failed to fetch asset' });
  }
});

// Create new asset
router.post('/', optionalAuth, (req, res) => {
  try {
    const title = String(req.body.title || '').trim();
    const description = String(req.body.description || '').trim();
    const priceAmount = Number(req.body.price?.amount ?? req.body.value ?? 0);
    if (title.length < 3 || description.length < 10 || !Number.isFinite(priceAmount) || priceAmount <= 0) {
      return res.status(400).json({ error: 'Valid title, description, and price are required' });
    }

    const ownerId = req.user?.userId || req.body.owner?.id || 'guest';
    const imageUrl = req.body.imageUrl || req.body.images?.[0] || '';
    const asset = db.createAsset({
      title,
      description,
      category: req.body.category || 'other',
      imageUrl,
      images: Array.isArray(req.body.images) && req.body.images.length ? req.body.images : (imageUrl ? [imageUrl] : []),
      price: {
        amount: priceAmount,
        currency: req.body.price?.currency || 'USDT'
      },
      tokenization: req.body.tokenization || {
        type: 'whole',
        totalTokens: 1,
        availableTokens: 1,
        pricePerToken: priceAmount
      },
      listingType: req.body.listingType || 'fixed',
      owner: req.body.owner || {
        id: ownerId,
        name: req.user?.email || 'Guest'
      },
      ownerId,
      status: req.body.status || 'pending',
      isVerified: Boolean(req.body.isVerified),
      tokenId: req.body.tokenId,
      value: priceAmount
    });

    res.status(201).json(asset);
  } catch (error) {
    console.error('Error creating asset:', error);
    res.status(500).json({ error: 'Failed to create asset' });
  }
});

// Update asset
router.patch('/:id', authenticateToken, validateAssetUpdate, (req, res) => {
  try {
    const existing = db.getAssetById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    const isOwner = existing.owner && existing.owner.id === req.user.userId;
    const isAdmin = (req.user.roles || []).includes('admin');
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const { status, isVerified, owner, ownerId, validation, ...safeUpdate } = req.body;
    const asset = db.updateAsset(req.params.id, safeUpdate);
    if (!asset) {
      return res.status(404).json({ error: 'Asset not found' });
    }
    res.json(asset);
  } catch (error) {
    console.error('Error updating asset:', error);
    res.status(500).json({ error: 'Failed to update asset' });
  }
});

// Get asset validation status
router.get('/:id/validation', (req, res) => {
  try {
    const asset = db.getAssetById(req.params.id);
    if (!asset) {
      return res.status(404).json({ error: 'Asset not found' });
    }
    
    res.json({
      validationId: asset.validation?.id || null,
      status: asset.validation?.status || 'pending',
      validatorId: asset.validation?.validatedBy || null,
      comments: asset.validation?.comments || null,
      timestamp: asset.validation?.validatedAt || asset.createdAt
    });
  } catch (error) {
    console.error('Error fetching validation status:', error);
    res.status(500).json({ error: 'Failed to fetch validation status' });
  }
});

// Request validation for asset
router.post('/:id/validation-requests', authenticateToken, (req, res) => {
  try {
    const { validatorId } = req.body;
    
    if (!validatorId) {
      return res.status(400).json({ error: 'Validator ID is required' });
    }
    
    const validator = db.getValidatorById(validatorId);
    if (!validator) {
      return res.status(404).json({ error: 'Validator not found' });
    }
    
    const asset = db.getAssetById(req.params.id);
    if (!asset) {
      return res.status(404).json({ error: 'Asset not found' });
    }
    
    const validationRequest = db.createValidationRequest({
      assetId: req.params.id,
      validatorId,
      requesterId: req.user.userId,
      status: 'pending'
    });
    
    res.status(201).json(validationRequest);
  } catch (error) {
    console.error('Error creating validation request:', error);
    res.status(500).json({ error: 'Failed to create validation request' });
  }
});

// Get validators for asset category
router.get('/:id/validators', (req, res) => {
  try {
    const asset = db.getAssetById(req.params.id);
    if (!asset) {
      return res.status(404).json({ error: 'Asset not found' });
    }
    
    const validators = db.getAllValidators({ 
      expertise: asset.category,
      availability: true 
    });
    
    res.json(validators);
  } catch (error) {
    console.error('Error fetching validators:', error);
    res.status(500).json({ error: 'Failed to fetch validators' });
  }
});

module.exports = router;
