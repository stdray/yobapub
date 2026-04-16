import { VideoFile, AudioTrack, Subtitle } from '../../types/api';
import { storage, Storage, QualityId, TitlePrefs } from '../../utils/storage';


const pickDefaultQualityIndex = (files: VideoFile[]): number => {
  let savedId = storage.getDefaultQuality();
  if (savedId === -1) {
    savedId = QualityId.Auto;
    storage.setDefaultQuality(savedId);
  }
  if (savedId === QualityId.Auto || files.length === 0) return 0;
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
  const wantForced = prefs.subForced === true;
  // exact match: lang + forced + shift
  if (prefs.subShift !== undefined) {
    for (let i = 0; i < subs.length; i++) {
      const s = subs[i];
      if (s.lang === prefs.subLang && (s.forced === true) === wantForced && s.shift === prefs.subShift) return i;
    }
  }
  // relaxed: lang + forced
  for (let i = 0; i < subs.length; i++) {
    const s = subs[i];
    if (s.lang === prefs.subLang && (s.forced === true) === wantForced) return i;
  }
  // last resort: lang only
  for (let i = 0; i < subs.length; i++) {
    if (subs[i].lang === prefs.subLang) return i;
  }
  return -1;
};

interface SavePrefsOpts {
  readonly itemId: number;
  readonly files: ReadonlyArray<VideoFile>;
  readonly audios: ReadonlyArray<AudioTrack>;
  readonly subs: ReadonlyArray<Subtitle>;
  readonly selectedQuality: number;
  readonly selectedAudio: number;
  readonly selectedSub: number;
}

export const saveCurrentPrefs = (opts: SavePrefsOpts): void => {
  const { itemId, files, audios, subs, selectedQuality, selectedAudio, selectedSub } = opts;
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
    const s = subs[selectedSub];
    prefs.subLang = s.lang;
    prefs.subForced = s.forced === true;
    prefs.subShift = s.shift;
  }
  storage.saveTitlePrefs(prefs);
};

export const getTitlePrefs = storage.getTitlePrefs;
