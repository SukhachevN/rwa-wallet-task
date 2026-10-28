const express = require('express');
const router = express.Router();
const db = require('../models/database');
const { authenticateToken } = require('../middleware/auth');

function toSafeNumber(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

router.get('/', (req, res) => {
  try {
    const { searchQuery, filterType } = req.query;
    let assets = Array.from(db.assets.values());

    if (searchQuery) {
      const term = String(searchQuery).toLowerCase();
      assets = assets.filter((asset) =>
        (asset.title || '').toLowerCase().includes(term) ||
        (asset.description || '').toLowerCase().includes(term)
      );
    }

    if (filterType) {
      assets = assets.filter((asset) => asset.category === filterType);
    }

    const allAssets = Array.from(db.assets.values());
    const stats = {
      totalAssets: db.assets.size,
      totalValue: allAssets.reduce((sum, asset) => sum + toSafeNumber(asset.value), 0),
      pendingValidations: allAssets.filter((asset) => asset.status === 'pending').length,
      actionRequired: allAssets.filter((asset) => asset.status === 'action_required').length
    };

    res.json({
      stats,
      assets: assets.slice(0, 10)
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

router.get('/pending-validations', authenticateToken, (req, res) => {
  try {
    const pendingAssets = Array.from(db.assets.values())
      .filter((asset) => asset.status === 'pending')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json(pendingAssets);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch pending validations' });
  }
});

router.get('/action-required', authenticateToken, (req, res) => {
  try {
    const actionRequiredAssets = Array.from(db.assets.values())
      .filter((asset) => asset.status === 'action_required')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json(actionRequiredAssets);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch action required assets' });
  }
});

router.get('/total-value', (req, res) => {
  try {
    const totalValue = Array.from(db.assets.values())
      .reduce((sum, asset) => sum + toSafeNumber(asset.value), 0);

    res.json({ totalValue });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch total value' });
  }
});

router.get('/portfolio/:userId', authenticateToken, (req, res) => {
  try {
    const { userId } = req.params;
    if (req.user.userId !== userId && !(req.user.roles || []).includes('admin')) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const userAssets = Array.from(db.assets.values())
      .filter((asset) => asset.owner && asset.owner.id === userId);

    const userTransactions = Array.from(db.transactions.values())
      .filter((transaction) =>
        transaction.buyerId === userId || transaction.sellerId === userId
      );

    const portfolioValue = userAssets.reduce((sum, asset) => sum + toSafeNumber(asset.value), 0);
    const totalInvested = userTransactions
      .filter((t) => t.buyerId === userId && t.status === 'completed')
      .reduce((sum, t) => sum + toSafeNumber(t.totalAmount), 0);

    const totalEarned = userTransactions
      .filter((t) => t.sellerId === userId && t.status === 'completed')
      .reduce((sum, t) => sum + toSafeNumber(t.totalAmount), 0);

    res.json({
      portfolioValue,
      totalInvested,
      totalEarned,
      assetCount: userAssets.length,
      transactionCount: userTransactions.length,
      assets: userAssets,
      recentTransactions: userTransactions.slice(0, 5)
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch portfolio' });
  }
});

router.get('/market-stats', (req, res) => {
  try {
    const assets = Array.from(db.assets.values());
    const totalMarketValue = assets.reduce((sum, asset) => sum + toSafeNumber(asset.value), 0);
    const averageAssetValue = assets.length ? totalMarketValue / assets.length : 0;

    const categoryStats = {};
    assets.forEach((asset) => {
      if (!categoryStats[asset.category]) {
        categoryStats[asset.category] = {
          count: 0,
          totalValue: 0,
          averageValue: 0
        };
      }
      categoryStats[asset.category].count++;
      categoryStats[asset.category].totalValue += toSafeNumber(asset.value);
    });

    Object.keys(categoryStats).forEach((category) => {
      const stats = categoryStats[category];
      stats.averageValue = stats.count ? stats.totalValue / stats.count : 0;
    });

    const priceRanges = {
      '0-10000': 0,
      '10000-50000': 0,
      '50000-100000': 0,
      '100000-500000': 0,
      '500000+': 0
    };

    assets.forEach((asset) => {
      const value = toSafeNumber(asset.value);
      if (value < 10000) priceRanges['0-10000']++;
      else if (value < 50000) priceRanges['10000-50000']++;
      else if (value < 100000) priceRanges['50000-100000']++;
      else if (value < 500000) priceRanges['100000-500000']++;
      else priceRanges['500000+']++;
    });

    res.json({
      totalMarketValue,
      averageAssetValue,
      totalAssets: assets.length,
      categoryStats,
      priceRanges,
      verifiedAssets: assets.filter((a) => a.isVerified).length,
      pendingAssets: assets.filter((a) => a.status === 'pending').length
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch market statistics' });
  }
});

module.exports = router;
