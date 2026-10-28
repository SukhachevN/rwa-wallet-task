import { Asset, AssetStatus } from '@/types';

// API response types
export interface DashboardStats {
  totalAssets: number;
  totalValue: number;
  pendingValidations: number;
  actionRequired: number;
}

export interface DashboardResponse {
  stats: DashboardStats;
  assets: Asset[];
}

// API endpoints for dashboard
export const dashboardApi = {
  // Fetch dashboard data including stats and filtered assets
  getDashboardData: async (searchQuery?: string, filterType?: string): Promise<DashboardResponse> => {
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.set('searchQuery', searchQuery);
      if (filterType) params.set('filterType', filterType);
      const query = params.toString();
      const response = await fetch(query ? `/api/dashboard?${query}` : '/api/dashboard');

      if (!response.ok) {
        throw new Error('Failed to fetch dashboard data');
      }

      return await response.json();
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      throw error;
    }
  },

  // Get pending validations
  getPendingValidations: async (): Promise<Asset[]> => {
    try {
      const response = await fetch('/api/dashboard/pending-validations');
      if (!response.ok) {
        throw new Error('Failed to fetch pending validations');
      }
      return await response.json();
    } catch (error) {
      console.error('Error fetching pending validations:', error);
      throw error;
    }
  },

  // Get assets requiring action
  getActionRequired: async (): Promise<Asset[]> => {
    try {
      const response = await fetch('/api/dashboard/action-required');
      if (!response.ok) {
        throw new Error('Failed to fetch action required assets');
      }
      return await response.json();
    } catch (error) {
      console.error('Error fetching action required assets:', error);
      throw error;
    }
  },

  // Get total portfolio value
  getTotalValue: async (): Promise<number> => {
    try {
      const response = await fetch('/api/dashboard/total-value');
      if (!response.ok) {
        throw new Error('Failed to fetch total value');
      }
      const data = await response.json();
      return data.totalValue;
    } catch (error) {
      console.error('Error fetching total value:', error);
      throw error;
    }
  },
};