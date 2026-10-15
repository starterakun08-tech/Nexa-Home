import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class StorageService {
  static const _storage = FlutterSecureStorage();

  static const _keyServerUrl = 'server_url';
  static const _keyAccessToken = 'access_token';
  static const _keyRefreshToken = 'refresh_token';
  static const _keyThemeMode = 'theme_mode'; // 'light' or 'dark'
  static const _keyBiometric = 'biometric_enabled';
  static const _keyUsername = 'saved_username';
  static const _keyRole = 'saved_role';
  static const _keyTtsVoice = 'tts_voice';
  static const _keyTtsAutoPlay = 'tts_auto_play';

  // Default server URL: domain produksi resmi yang dapat diakses langsung oleh ponsel fisik
  static const defaultServerUrl = 'https://aujasena.my.id';
  static const fallbackUsbUrl = 'http://127.0.0.1:8000';
  static const fallbackLanUrl = 'http://192.168.1.21:8000';

  static const candidateServerUrls = [
    'https://aujasena.my.id',
    'http://127.0.0.1:8000',
    'http://192.168.1.21:8000',
  ];

  static Future<String> getServerUrl() async {
    final val = await _storage.read(key: _keyServerUrl);
    if (val == null || val.contains('10.0.2.2') || val.trim().isEmpty) {
      await _storage.write(key: _keyServerUrl, value: defaultServerUrl);
      return defaultServerUrl;
    }
    return val.trim();
  }

  static Future<void> setServerUrl(String url) async {
    var clean = url.trim();
    if (clean.endsWith('/')) {
      clean = clean.substring(0, clean.length - 1);
    }
    await _storage.write(key: _keyServerUrl, value: clean);
  }

  static Future<String?> getAccessToken() => _storage.read(key: _keyAccessToken);
  static Future<void> setAccessToken(String? token) async {
    if (token == null) {
      await _storage.delete(key: _keyAccessToken);
    } else {
      await _storage.write(key: _keyAccessToken, value: token);
    }
  }

  static Future<String?> getRefreshToken() => _storage.read(key: _keyRefreshToken);
  static Future<void> setRefreshToken(String? token) async {
    if (token == null) {
      await _storage.delete(key: _keyRefreshToken);
    } else {
      await _storage.write(key: _keyRefreshToken, value: token);
    }
  }

  static Future<String> getThemeMode() async {
    final val = await _storage.read(key: _keyThemeMode);
    return val ?? 'light';
  }

  static Future<void> setThemeMode(String mode) async {
    await _storage.write(key: _keyThemeMode, value: mode);
  }

  static Future<bool> isBiometricEnabled() async {
    final val = await _storage.read(key: _keyBiometric);
    return val == 'true';
  }

  static Future<void> setBiometricEnabled(bool enabled) async {
    await _storage.write(key: _keyBiometric, value: enabled ? 'true' : 'false');
  }

  static Future<String?> getUsername() => _storage.read(key: _keyUsername);
  static Future<void> setUsername(String? name) async {
    if (name == null) {
      await _storage.delete(key: _keyUsername);
    } else {
      await _storage.write(key: _keyUsername, value: name);
    }
  }

  static Future<String?> getRole() => _storage.read(key: _keyRole);
  static Future<void> setRole(String? role) async {
    if (role == null) {
      await _storage.delete(key: _keyRole);
    } else {
      await _storage.write(key: _keyRole, value: role);
    }
  }

  static Future<String> getTtsVoice() async {
    final val = await _storage.read(key: _keyTtsVoice);
    return val ?? 'id-ID-ArdiNeural';
  }

  static Future<void> setTtsVoice(String voice) async {
    await _storage.write(key: _keyTtsVoice, value: voice);
  }

  static Future<bool> isTtsAutoPlay() async {
    final val = await _storage.read(key: _keyTtsAutoPlay);
    return val == null || val == 'true';
  }

  static Future<void> setTtsAutoPlay(bool enabled) async {
    await _storage.write(key: _keyTtsAutoPlay, value: enabled ? 'true' : 'false');
  }

  static Future<void> clearAuth() async {
    await _storage.delete(key: _keyAccessToken);
    await _storage.delete(key: _keyRefreshToken);
    await _storage.delete(key: _keyUsername);
    await _storage.delete(key: _keyRole);
  }

}
