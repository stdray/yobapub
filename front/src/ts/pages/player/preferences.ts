import { VideoFile, AudioTrack, Subtitle } from '../../types/api';
import { getDefaultQuality, setDefaultQuality, QUALITY_OPTIONS, getTitlePrefs, saveTitlePrefs, TitlePrefs } from '../../utils/storage';
import { isLegacyTizen } from '../../utils/platform';

export type { TitlePrefs };

export function pickDefaultQualityIndex(files: VideoFile[]): number {
  var savedId = getDefaultQuality();
  if (savedId === -1) {
    savedId = isLegacyTizen() ? 3 : 0;
    setDefaultQuality(savedId);
  }
  if (savedId === 0 || files.length === 0) return 0;
  var maxH = 0;
  for (var q = 0; q < QUALITY_OPTIONS.length; q++) {
    if (QUALITY_OPTIONS[q].id === savedId) { maxH = QUALITY_OPTIONS[q].maxH; break; }
  }
  if (maxH === 0) return 0;
  for (var i = 0; i < files.length; i++) {
    if (files[i].h <= maxH) return i;
  }
  return files.length - 1;
}

export function restoreQualityIndex(files: VideoFile[], prefs: TitlePrefs | null): number {
  if (prefs && prefs.quality) {
    for (var i = 0; i < files.length; i++) {
      if (files[i].quality === prefs.quality) return i;
    }
  }
  return pickDefaultQualityIndex(files);
}

export function restoreAudioIndex(audios: AudioTrack[], prefs: TitlePrefs | null): number {
  if (!prefs || !prefs.audioLang || audios.length === 0) return 0;
  if (prefs.audioAuthorId) {
    for (var i = 0; i < audios.length; i++) {
      if (audios[i].lang === prefs.audioLang && audios[i].author && audios[i].author.id === prefs.audioAuthorId) return i;
    }
  }
  for (var j = 0; j < audios.length; j++) {
    if (audios[j].lang === prefs.audioLang) return j;
  }
  return 0;
}

export function restoreSubIndex(subs: Subtitle[], prefs: TitlePrefs | null): number {
  if (!prefs || !prefs.subLang || subs.length === 0) return -1;
  for (var i = 0; i < subs.length; i++) {
    if (subs[i].lang === prefs.subLang) return i;
  }
  return -1;
}

export function saveCurrentPrefs(
  itemId: number,
  files: VideoFile[],
  audios: AudioTrack[],
  subs: Subtitle[],
  selectedQuality: number,
  selectedAudio: number,
  selectedSub: number
): void {
  var prefs: TitlePrefs = { id: itemId };
  if (files.length > 0 && selectedQuality < files.length) {
    prefs.quality = files[selectedQuality].quality;
  }
  if (audios.length > 0 && selectedAudio < audios.length) {
    var a = audios[selectedAudio];
    prefs.audioLang = a.lang;
    if (a.author) prefs.audioAuthorId = a.author.id;
  }
  if (selectedSub >= 0 && selectedSub < subs.length) {
    prefs.subLang = subs[selectedSub].lang;
  }
  saveTitlePrefs(prefs);
}

export { getTitlePrefs };
