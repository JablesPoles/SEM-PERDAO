import { expect, test } from 'playwright/test';

import {
  AUDIO_CHANNELS,
  getAudioChannelVolume,
  isAudioChannelEnabled,
  setAudioChannelEnabled,
  setAudioChannelVolume,
} from '../src/lib/sounds';

test('mixer mantém efeitos, música e narração independentes', () => {
  expect(AUDIO_CHANNELS).toEqual(['effects', 'music', 'narration']);
  setAudioChannelEnabled('effects', false);
  setAudioChannelEnabled('music', true);
  setAudioChannelEnabled('narration', false);
  expect(isAudioChannelEnabled('effects')).toBe(false);
  expect(isAudioChannelEnabled('music')).toBe(true);
  expect(isAudioChannelEnabled('narration')).toBe(false);

  setAudioChannelVolume('effects', 2);
  setAudioChannelVolume('music', 0.35);
  setAudioChannelVolume('narration', -1);
  expect(getAudioChannelVolume('effects')).toBe(1);
  expect(getAudioChannelVolume('music')).toBe(0.35);
  expect(getAudioChannelVolume('narration')).toBe(0);
});
