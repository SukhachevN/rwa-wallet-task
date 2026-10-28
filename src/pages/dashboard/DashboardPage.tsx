import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Package, DollarSign, Clock, AlertCircle, Search, Filter } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useMockDataStore } from '@/store/mockDataStore';
import { formatCurrency } from '@/utils/format';
import { useAuthStore } from '@/store/authStore';
import { isOnChainConfigured } from '@/utils/onchain';
import { dashboardApi, DashboardStats } from '@/api/dashboard';

function statusLabel(status?: string) {
  if (!status) {
    return 'Unknown';
  }
  return status.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusClasses(status?: string) {
  if (status === 'validated') return 'bg-green-100 text-green-700';
  if (status === 'pending') return 'bg-blue-100 text-blue-700';
  if (status === 'action_required') return 'bg-amber-100 text-amber-700';
  return 'bg-red-100 text-red-700';
}

export default function DashboardPage() {
  const {
    assets,
    getFilteredAssets,
    getPendingValidations,
    getActionRequired,
    getTotalValue,
    searchQuery,
    setSearchQuery,
    filterType,
    setFilterType,
    fetchAssets
  } = useMockDataStore();

  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);

  useEffect(() => {
    fetchAssets();
  }, [fetchAssets]);

  useEffect(() => {
    dashboardApi
      .getDashboardData(searchQuery, filterType === 'all' ? undefined : filterType)
      .then((data) => setDashboardStats(data.stats))
      .catch(() => setDashboardStats(null));
  }, [searchQuery, filterType]);
  const user = useAuthStore((state) => state.user);
  const switchToPharos = useAuthStore((state) => state.switchToPharos);
  const wallet = user?.wallet;
  const onPharos = wallet?.chainId === 50002;
  const onHardhat = wallet?.chainId === 31337;
  const chainReady = onPharos || onHardhat;
  const onChainLive = isOnChainConfigured();
  const walletLabel = wallet?.address
    ? `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`
    : 'Not connected';

  const filteredAssets = useMemo(() => {
    try {
      return getFilteredAssets() || [];
    } catch {
      return assets || [];
    }
  }, [assets, getFilteredAssets, searchQuery, filterType]);

  const pendingValidations = useMemo(() => {
    try {
      return getPendingValidations() || [];
    } catch {
      return [];
    }
  }, [getPendingValidations]);

  const actionRequired = useMemo(() => {
    try {
      return getActionRequired() || [];
    } catch {
      return [];
    }
  }, [getActionRequired]);

  const totalValue = useMemo(() => {
    try {
      return getTotalValue();
    } catch {
      return 0;
    }
  }, [getTotalValue]);

  const displayName = user?.name || user?.wallet?.address?.slice(0, 6) || 'there';

  const stats = [
    {
      icon: Package,
      label: 'Total Assets',
      value: String(dashboardStats?.totalAssets ?? assets?.length ?? 0),
      iconBg: 'bg-blue-50',
      iconColor: 'text-blue-600'
    },
    {
      icon: DollarSign,
      label: 'Total Value',
      value: formatCurrency(dashboardStats?.totalValue ?? totalValue),
      iconBg: 'bg-green-50',
      iconColor: 'text-green-600'
    },
    {
      icon: Clock,
      label: 'Pending Validations',
      value: String(dashboardStats?.pendingValidations ?? pendingValidations.length),
      iconBg: 'bg-amber-50',
      iconColor: 'text-amber-600'
    },
    {
      icon: AlertCircle,
      label: 'Action Required',
      value: String(dashboardStats?.actionRequired ?? actionRequired.length),
      iconBg: 'bg-red-50',
      iconColor: 'text-red-600'
    }
  ];

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-500 mt-1">
            Welcome back{displayName ? `, ${displayName}` : ''}! Here's an overview of your assets
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-gray-500">Wallet</p>
          <p className="font-medium text-gray-900">{walletLabel}</p>
          <p className={`text-xs mt-1 ${chainReady ? 'text-green-600' : 'text-amber-600'}`}>
            {onHardhat ? 'Hardhat Local' : onPharos ? 'Pharos Devnet' : wallet?.chainId ? `Chain ${wallet.chainId}` : 'Network unknown'}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {onChainLive ? 'On-chain contracts configured' : 'Local demo only'}
          </p>
          {!chainReady && wallet?.isConnected ? (
            <Button
              variant="outline"
              className="mt-2"
              onClick={() => switchToPharos()}
            >
              Switch network
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="bg-white rounded-lg p-4 flex items-center gap-4 border border-gray-100"
          >
            <div className={`p-3 rounded-lg ${stat.iconBg}`}>
              <stat.icon className={`w-6 h-6 ${stat.iconColor}`} />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">{stat.label}</p>
              <p className="text-2xl font-semibold text-gray-900 mt-1">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            placeholder="Search assets..."
            value={searchQuery || ''}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex gap-3">
          <Button
            variant="outline"
            className="flex items-center gap-2 border-gray-200 text-gray-700"
            onClick={() => setFilterType('all')}
          >
            <Filter size={18} />
            Clear
          </Button>
          <select
            value={filterType || 'all'}
            onChange={(e) => setFilterType(e.target.value as any)}
            className="px-4 py-2.5 rounded-lg border border-gray-200 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[160px]"
          >
            <option value="all">All Types</option>
            <option value="art">Art</option>
            <option value="watches">Watches</option>
            <option value="jewelry">Jewelry</option>
            <option value="real-estate">Real Estate</option>
            <option value="collectibles">Collectibles</option>
          </select>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {filteredAssets.length === 0 ? (
          <div className="p-10 text-center text-gray-500">
            No assets match your current filters.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-6">
            {filteredAssets.map((asset) => (
              <motion.div
                key={asset.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-lg border border-gray-100 overflow-hidden"
              >
                <div className="aspect-video relative bg-gray-100">
                  {asset.imageUrl ? (
                    <img
                      src={asset.imageUrl}
                      alt={asset.title || 'Asset'}
                      className="w-full h-full object-cover"
                    />
                  ) : null}
                  <div className="absolute top-2 right-2">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusClasses(asset.status)}`}>
                      {statusLabel(asset.status)}
                    </span>
                  </div>
                </div>
                <div className="p-4">
                  <h3 className="font-semibold text-gray-900">{asset.title || 'Untitled asset'}</h3>
                  <p className="text-sm text-gray-500 mt-1">{asset.description || 'No description'}</p>
                  <div className="flex items-center justify-between mt-3">
                    <span className="text-sm font-medium text-gray-900">
                      {formatCurrency(asset.value ?? asset.price?.amount ?? 0)}
                    </span>
                    <span className="text-xs text-gray-500">
                      {asset.createdAt ? new Date(asset.createdAt).toLocaleDateString() : '—'}
                    </span>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
