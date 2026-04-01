import { apiClient } from './client';
import { BookmarkFoldersResponse, BookmarkItemsResponse, BookmarkItemFoldersResponse, BookmarkToggleResponse } from '../types/api';

export const getBookmarkFolders = (): JQueryDeferred<BookmarkFoldersResponse> =>
  apiClient.apiGetWithRefresh('/v1/bookmarks');

export const getBookmarkItems = (folderId: number, page?: number): JQueryDeferred<BookmarkItemsResponse> => {
  const params: Record<string, number> = {};
  if (page) { params.page = page; }
  return apiClient.apiGetWithRefresh('/v1/bookmarks/' + folderId, params);
};

export const getItemFolders = (itemId: number): JQueryDeferred<BookmarkItemFoldersResponse> =>
  apiClient.apiGetWithRefresh('/v1/bookmarks/get-item-folders', { item: itemId });

export const toggleBookmarkItem = (itemId: number, folderId: number): JQueryDeferred<BookmarkToggleResponse> =>
  apiClient.apiPostWithRefresh('/v1/bookmarks/toggle-item', { item: itemId, folder: folderId });

export const createBookmarkFolder = (title: string): JQueryDeferred<BookmarkFoldersResponse> =>
  apiClient.apiPostWithRefresh('/v1/bookmarks/create', { title: title });
