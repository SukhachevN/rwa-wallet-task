const express = require('express');
const router = express.Router();
const db = require('../models/database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { validatePurchase, validateBid } = require('../middleware/validation');

// Process asset purchase
router.post('/purchase', authenticateToken, validatePurchase, (req, res) => {
  try {
    const {
      assetId,
      paymentMethod,
      amount,
      tokens
    } = req.body;
    const buyerId = req.user.userId;

    // Validate required fields
    if (!assetId || !buyerId || !paymentMethod || !amount) {
      return res.status(400).json({ 
        error: 'Missing required fields: assetId, buyerId, paymentMethod, amount' 
      });
    }

    const asset = db.getAssetById(assetId);
    if (!asset) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    // Check if asset is available for purchase
    if (asset.status !== 'validated' && asset.status !== 'listed') {
      return res.status(400).json({ error: 'Asset is not available for purchase' });
    }

    // Create transaction
    const transaction = db.createTransaction({
      assetId,
      buyerId,
      sellerId: asset.owner.id,
      type: 'purchase',
      tokens: tokens || 1,
      pricePerToken: asset.tokenization.pricePerToken,
      totalAmount: amount,
      currency: asset.price.currency,
      paymentMethod,
      paymentStatus: 'pending',
      status: 'pending'
    });

    res.status(201).json({
      transactionId: transaction.id,
      status: 'pending',
      message: 'Purchase initiated successfully. Please complete payment to finalize the transaction.'
    });
  } catch (error) {
    console.error('Error processing purchase:', error);
    res.status(500).json({ error: 'Failed to process purchase' });
  }
});

// Process bid placement
router.post('/bid', authenticateToken, validateBid, (req, res) => {
  try {
    const {
      assetId,
      bidAmount,
      autoBidLimit
    } = req.body;
    const bidderId = req.user.userId;

    // Validate required fields
    if (!assetId || !bidAmount) {
      return res.status(400).json({ 
        error: 'Missing required fields: assetId, bidderId, bidAmount' 
      });
    }

    const asset = db.getAssetById(assetId);
    if (!asset) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    // Check if asset is available for bidding
    if (asset.listingType !== 'auction') {
      return res.status(400).json({ error: 'Asset is not available for bidding' });
    }

    // Create transaction for bid
    const transaction = db.createTransaction({
      assetId,
      buyerId: bidderId,
      sellerId: asset.owner.id,
      type: 'bid',
      tokens: 1,
      pricePerToken: bidAmount,
      totalAmount: bidAmount,
      currency: asset.price.currency,
      paymentMethod: 'crypto',
      paymentStatus: 'pending',
      status: 'pending',
      autoBidLimit
    });

    res.status(201).json({
      transactionId: transaction.id,
      status: 'pending',
      message: 'Bid placed successfully. You will be notified if you win the auction.'
    });
  } catch (error) {
    console.error('Error processing bid:', error);
    res.status(500).json({ error: 'Failed to process bid' });
  }
});

// Get transaction history
router.get('/history', authenticateToken, (req, res) => {
  try {
    const {
      userId,
      assetId,
      type,
      startDate,
      endDate,
      page = 1,
      limit = 20
    } = req.query;

    let transactions = Array.from(db.transactions.values());

    // Apply filters
    const requesterId = req.user.userId;
    const isAdmin = (req.user.roles || []).includes('admin');
    if (!isAdmin) {
      transactions = transactions.filter((t) =>
        t.buyerId === requesterId || t.sellerId === requesterId
      );
    } else if (userId) {
      transactions = transactions.filter((t) =>
        t.buyerId === userId || t.sellerId === userId
      );
    }

    if (assetId) {
      transactions = transactions.filter(t => t.assetId === assetId);
    }

    if (type && type !== 'all') {
      transactions = transactions.filter(t => t.type === type);
    }

    if (startDate) {
      transactions = transactions.filter(t => 
        new Date(t.createdAt) >= new Date(startDate)
      );
    }

    if (endDate) {
      transactions = transactions.filter(t => 
        new Date(t.createdAt) <= new Date(endDate)
      );
    }

    // Sort by creation date (newest first)
    transactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedTransactions = transactions.slice(startIndex, endIndex);

    res.json({
      transactions: paginatedTransactions,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(transactions.length / limit),
        totalItems: transactions.length,
        itemsPerPage: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Error fetching transaction history:', error);
    res.status(500).json({ error: 'Failed to fetch transaction history' });
  }
});

// Get transaction details
router.get('/:transactionId', authenticateToken, (req, res) => {
  try {
    const transaction = db.transactions.get(req.params.transactionId);
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const isParty = transaction.buyerId === req.user.userId || transaction.sellerId === req.user.userId;
    const isAdmin = (req.user.roles || []).includes('admin');
    if (!isParty && !isAdmin) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Get asset details
    const asset = db.getAssetById(transaction.assetId);
    const transactionWithAsset = {
      ...transaction,
      asset: asset ? {
        id: asset.id,
        title: asset.title,
        imageUrl: asset.imageUrl
      } : null
    };

    res.json(transactionWithAsset);
  } catch (error) {
    console.error('Error fetching transaction details:', error);
    res.status(500).json({ error: 'Failed to fetch transaction details' });
  }
});

// Process refund
router.post('/refund', authenticateToken, (req, res) => {
  try {
    const {
      transactionId,
      reason,
      amount
    } = req.body;

    // Validate required fields
    if (!transactionId || !reason) {
      return res.status(400).json({ 
        error: 'Missing required fields: transactionId, reason' 
      });
    }

    const transaction = db.transactions.get(transactionId);
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    if (transaction.buyerId !== req.user.userId && !(req.user.roles || []).includes('admin')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Check if transaction is eligible for refund
    if (transaction.status !== 'completed') {
      return res.status(400).json({ error: 'Transaction is not eligible for refund' });
    }

    // Create refund transaction
    const refundTransaction = db.createTransaction({
      assetId: transaction.assetId,
      buyerId: transaction.sellerId, // Reverse buyer/seller for refund
      sellerId: transaction.buyerId,
      type: 'refund',
      tokens: transaction.tokens,
      pricePerToken: transaction.pricePerToken,
      totalAmount: amount || transaction.totalAmount,
      currency: transaction.currency,
      paymentMethod: transaction.paymentMethod,
      paymentStatus: 'pending',
      status: 'pending',
      refundReason: reason,
      originalTransactionId: transactionId
    });

    res.status(201).json({
      refundId: refundTransaction.id,
      status: 'pending',
      message: 'Refund request submitted successfully. You will be notified once processed.'
    });
  } catch (error) {
    console.error('Error processing refund:', error);
    res.status(500).json({ error: 'Failed to process refund' });
  }
});

// Update transaction status
router.patch('/:transactionId', authenticateToken, requireRole(['admin']), (req, res) => {
  try {
    const { status, paymentStatus, transactionHash } = req.body;
    
    const transaction = db.transactions.get(req.params.transactionId);
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const updatedTransaction = {
      ...transaction,
      status: status || transaction.status,
      paymentStatus: paymentStatus || transaction.paymentStatus,
      transactionHash: transactionHash || transaction.transactionHash,
      updatedAt: new Date()
    };

    db.transactions.set(req.params.transactionId, updatedTransaction);

    res.json(updatedTransaction);
  } catch (error) {
    console.error('Error updating transaction:', error);
    res.status(500).json({ error: 'Failed to update transaction' });
  }
});

module.exports = router;
