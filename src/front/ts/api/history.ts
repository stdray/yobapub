import { apiClient } from './client';
import { HistoryResponse } from '../types/api';

export const getHistory = (page?: number): JQueryDeferred<HistoryResponse> =>
  apiClient.apiGetWithRefresh('/v1/history', page ? { perpage: 20, page } : { perpage: 20 });
