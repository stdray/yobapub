import { VideoFile, AudioTrack, Subtitle } from '../../types/api';
import { storage, Storage, TitlePrefs } from '../../utils/storage';
import { platform } from '../../utils/platform';

export type { TitlePrefs };

export const pickDefaultQualityIndex = (files: VideoFile[]): number => {
  let savedId = storage.getDefaultQuality();
  if (savedId === -1) {
    savedId = platform.isLegacyTizen() ? 3 : 0;
    storage.setDefaultQuality(savedId);
  }
  if (savedId === 0 || files.length === 0) return 0;
  let maxH = 0;
  for (let q = 0; q < Storage.QUALITY_OPTIONS.length; q++) {
    if (Storage.QUALITY_OPTIONS[q].id === savedId) { maxH = Storage.QUALITY_OPTIONS[q].maxH; break; }
  }
  if (maxH === 0) return 0;
  for (let i = 0; i < files.length; i++) {
    if (files[i].h <= maxH) return i;
  }
  return files.length - 1;
};

export const restoreQualityIndex = (files: VideoFile[], prefs: TitlePrefs | null): number => {
  if (prefs && prefs.quality) {
    for (let i = 0; i < files.length; i++) {
      if (files[i].quality === prefs.quality) return i;
    }
  }
  return pickDefaultQualityIndex(files);
};

export const restoreAudioIndex = (audios: AudioTrack[], prefs: TitlePrefs | null): number => {
  if (!prefs || !prefs.audioLang || audios.length === 0) return 0;
  if (prefs.audioAuthorId) {
    for (let i = 0; i < audios.length; i++) {
      if (audios[i].lang === prefs.audioLang && audios[i].author && audios[i].author.id === prefs.audioAuthorId) return i;
    }
  }
  for (let j = 0; j < audios.length; j++) {
    if (audios[j].lang === prefs.audioLang) return j;
  }
  return 0;
};

export const restoreSubIndex = (subs: Subtitle[], prefs: TitlePrefs | null): number => {
  if (!prefs || !prefs.subLang || subs.length === 0) return -1;
  for (let i = 0; i < subs.length; i++) {
    if (subs[i].lang === prefs.subLang) return i;
  }
  return -1;
};

export const saveCurrentPrefs = (
  itemId: number,
  files: VideoFile[],
  audios: AudioTrack[],
  subs: Subtitle[],
  selectedQuality: number,
  selectedAudio: number,
  selectedSub: number
): void => {
  const prefs: TitlePrefs = { id: itemId };
  if (files.length > 0 && selectedQuality < files.length) {
    prefs.quality = files[selectedQuality].quality;
  }
  if (audios.length > 0 && selectedAudio < audios.length) {
    const a = audios[selectedAudio];
    prefs.audioLang = a.lang;
    if (a.author) prefs.audioAuthorId = a.author.id;
  }
  if (selectedSub >= 0 && selectedSub < subs.length) {
    prefs.subLang = subs[selectedSub].lang;
  }
  storage.saveTitlePrefs(prefs);
};

export const getTitlePrefs = storage.getTitlePrefs;
