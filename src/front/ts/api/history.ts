import { apiClient } from './client';
import { HistoryResponse } from '../types/api';

export const getHistory = (page?: number): JQueryDeferred<HistoryResponse> => {
  const params: Record<string, number> = { perpage: 20 };
  if (page) { params.page = page; }
  return apiClient.apiGetWithRefresh('/v1/history', params);
};
