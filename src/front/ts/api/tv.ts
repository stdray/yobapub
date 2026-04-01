import { apiClient } from './client';
import { TvChannelsResponse } from '../types/api';

export const getTvChannels = (): JQueryDeferred<TvChannelsResponse> =>
  apiClient.apiGetWithRefresh('/v1/tv');
