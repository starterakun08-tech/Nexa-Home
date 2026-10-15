import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:app/core/api_client.dart';
import 'package:app/core/storage.dart';

enum AuthStatus {
  initial,
  needsSetup,
  unauthenticated,
  twoFactorPending,
  authenticated,
}

class AuthState {
  final AuthStatus status;
  final String? username;
  final String? email;
  final String? fullName;
  final String? role;
  final bool isGoogleLinked;
  final String? tempToken;
  final String? errorMessage;
  final bool isLoading;

  const AuthState({
    required this.status,
    this.username,
    this.email,
    this.fullName,
    this.role,
    this.isGoogleLinked = false,
    this.tempToken,
    this.errorMessage,
    this.isLoading = false,
  });

  AuthState copyWith({
    AuthStatus? status,
    String? username,
    String? email,
    String? fullName,
    String? role,
    bool? isGoogleLinked,
    String? tempToken,
    String? errorMessage,
    bool? isLoading,
  }) {
    return AuthState(
      status: status ?? this.status,
      username: username ?? this.username,
      email: email ?? this.email,
      fullName: fullName ?? this.fullName,
      role: role ?? this.role,
      isGoogleLinked: isGoogleLinked ?? this.isGoogleLinked,
      tempToken: tempToken ?? this.tempToken,
      errorMessage: errorMessage,
      isLoading: isLoading ?? this.isLoading,
    );
  }
}

class AuthNotifier extends Notifier<AuthState> {
  @override
  AuthState build() {
    Future.microtask(() => init());
    return const AuthState(status: AuthStatus.initial);
  }

  Future<void> init() async {
    state = state.copyWith(isLoading: true);
    try {
      final dio = await ApiClient.getInstance();
      final res = await dio.get('/api/auth/setup-status');
      final isSetup = res.data['is_setup'] as bool? ?? false;

      if (!isSetup) {
        state = state.copyWith(status: AuthStatus.needsSetup, isLoading: false);
        return;
      }

      final token = await StorageService.getAccessToken();
      if (token != null && token.isNotEmpty) {
        try {
          final meRes = await dio.get('/api/auth/me');
          final user = meRes.data;
          state = AuthState(
            status: AuthStatus.authenticated,
            username: user['username'] as String?,
            email: user['email'] as String?,
            fullName: user['full_name'] as String?,
            role: user['role'] as String?,
            isGoogleLinked: user['google_id'] != null,
            isLoading: false,
          );
          return;
        } catch (_) {
          await StorageService.clearAuth();
        }
      }

      state = state.copyWith(status: AuthStatus.unauthenticated, isLoading: false);
    } catch (_) {
      state = state.copyWith(
        status: AuthStatus.unauthenticated,
        errorMessage: 'Gagal terhubung ke server',
        isLoading: false,
      );
    }
  }

  Future<void> refreshMe() async {
    try {
      final dio = await ApiClient.getInstance();
      final res = await dio.get('/api/auth/me');
      final user = res.data;
      state = state.copyWith(
        username: user['username'] as String?,
        email: user['email'] as String?,
        fullName: user['full_name'] as String?,
        role: user['role'] as String?,
        isGoogleLinked: user['google_id'] != null,
      );
    } catch (_) {}
  }

  Future<bool> setupAdmin({
    required String setupCode,
    required String username,
    required String password,
  }) async {
    state = state.copyWith(isLoading: true, errorMessage: null);
    try {
      final dio = await ApiClient.getInstance();
      final res = await dio.post(
        '/api/auth/setup-admin',
        data: {
          'setup_code': setupCode.trim(),
          'username': username.trim(),
          'password': password,
        },
      );
      if (res.statusCode == 201) {
        state = state.copyWith(status: AuthStatus.unauthenticated, isLoading: false);
        return true;
      }
      return false;
    } on DioException catch (e) {
      String msg = 'Setup gagal';
      if (e.response?.data != null) {
        msg = e.response!.data['detail']?.toString() ?? msg;
      }
      state = state.copyWith(isLoading: false, errorMessage: msg);
      return false;
    } catch (_) {
      state = state.copyWith(isLoading: false, errorMessage: 'Terjadi kesalahan sistem.');
      return false;
    }
  }

  Future<bool> login(String usernameOrEmail, String password) async {
    state = state.copyWith(isLoading: true, errorMessage: null);
    try {
      final dio = await ApiClient.getInstance();
      final res = await dio.post(
        '/api/auth/login',
        data: {'username': usernameOrEmail.trim(), 'password': password},
      );

      final data = res.data;
      if (data['status'] == '2fa_required') {
        state = state.copyWith(
          status: AuthStatus.twoFactorPending,
          username: usernameOrEmail.trim(),
          tempToken: data['temp_token'] as String?,
          isLoading: false,
        );
        return true;
      }

      final access = data['access_token'] as String;
      final refresh = data['refresh_token'] as String;
      final user = data['user'];
      final role = user['role'] as String;
      final uname = user['username'] as String;

      await StorageService.setAccessToken(access);
      await StorageService.setRefreshToken(refresh);
      await StorageService.setUsername(uname);
      await StorageService.setRole(role);

      state = AuthState(
        status: AuthStatus.authenticated,
        username: uname,
        email: user['email'] as String?,
        fullName: user['full_name'] as String?,
        role: role,
        isGoogleLinked: user['google_id'] != null,
        isLoading: false,
      );
      return true;
    } on DioException catch (e) {
      String msg = 'Login gagal';
      if (e.response?.data != null) {
        msg = e.response!.data['detail']?.toString() ?? msg;
      }
      state = state.copyWith(isLoading: false, errorMessage: msg);
      return false;
    } catch (_) {
      state = state.copyWith(isLoading: false, errorMessage: 'Koneksi ke server gagal.');
      return false;
    }
  }

  Future<bool> register({
    required String fullName,
    required String username,
    required String email,
    required String password,
    String? inviteCode,
  }) async {
    state = state.copyWith(isLoading: true, errorMessage: null);
    try {
      final dio = await ApiClient.getInstance();
      final body = <String, dynamic>{
        'full_name': fullName.trim(),
        'username': username.trim(),
        'email': email.trim().toLowerCase(),
        'password': password,
      };
      if (inviteCode != null && inviteCode.trim().isNotEmpty) {
        body['invite_code'] = inviteCode.trim();
      }
      final res = await dio.post('/api/auth/register', data: body);

      final data = res.data;
      final access = data['access_token'] as String;
      final refresh = data['refresh_token'] as String;
      final user = data['user'];
      final role = user['role'] as String;
      final uname = user['username'] as String;

      await StorageService.setAccessToken(access);
      await StorageService.setRefreshToken(refresh);
      await StorageService.setUsername(uname);
      await StorageService.setRole(role);

      state = AuthState(
        status: AuthStatus.authenticated,
        username: uname,
        email: user['email'] as String?,
        fullName: user['full_name'] as String?,
        role: role,
        isGoogleLinked: user['google_id'] != null,
        isLoading: false,
      );
      return true;
    } on DioException catch (e) {
      String msg = 'Pendaftaran gagal';
      if (e.response?.data != null) {
        msg = e.response!.data['detail']?.toString() ?? msg;
      }
      state = state.copyWith(isLoading: false, errorMessage: msg);
      return false;
    } catch (_) {
      state = state.copyWith(isLoading: false, errorMessage: 'Koneksi ke server gagal.');
      return false;
    }
  }

  Future<bool> googleAuth({
    String? idToken,
    String? accessToken,
    String? code,
    String? redirectUri,
    String? inviteCode,
  }) async {
    state = state.copyWith(isLoading: true, errorMessage: null);
    try {
      final dio = await ApiClient.getInstance();
      final body = <String, dynamic>{};
      if (idToken != null) body['id_token'] = idToken.trim();
      if (accessToken != null) body['access_token'] = accessToken.trim();
      if (code != null) body['code'] = code.trim();
      if (redirectUri != null) body['redirect_uri'] = redirectUri.trim();
      if (inviteCode != null && inviteCode.trim().isNotEmpty) {
        body['invite_code'] = inviteCode.trim();
      }

      final res = await dio.post('/api/auth/google', data: body);
      final data = res.data;

      if (data['status'] == '2fa_required') {
        state = state.copyWith(
          status: AuthStatus.twoFactorPending,
          tempToken: data['temp_token'] as String?,
          isLoading: false,
        );
        return true;
      }

      final access = data['access_token'] as String;
      final refresh = data['refresh_token'] as String;
      final user = data['user'];
      final role = user['role'] as String;
      final uname = user['username'] as String;

      await StorageService.setAccessToken(access);
      await StorageService.setRefreshToken(refresh);
      await StorageService.setUsername(uname);
      await StorageService.setRole(role);

      state = AuthState(
        status: AuthStatus.authenticated,
        username: uname,
        email: user['email'] as String?,
        fullName: user['full_name'] as String?,
        role: role,
        isGoogleLinked: true,
        isLoading: false,
      );
      return true;
    } on DioException catch (e) {
      String msg = 'Login Google gagal';
      if (e.response?.data != null) {
        msg = e.response!.data['detail']?.toString() ?? msg;
      }
      state = state.copyWith(isLoading: false, errorMessage: msg);
      return false;
    } catch (_) {
      state = state.copyWith(isLoading: false, errorMessage: 'Koneksi ke server gagal.');
      return false;
    }
  }

  Future<bool> googleLogin(String idToken) => googleAuth(idToken: idToken);

  Future<String?> linkGoogle(String idToken) async {
    try {
      final dio = await ApiClient.getInstance();
      await dio.post(
        '/api/auth/link-google',
        data: {'id_token': idToken.trim()},
      );
      await refreshMe();
      return null;
    } on DioException catch (e) {
      if (e.response?.data != null) {
        return e.response!.data['detail']?.toString() ?? 'Gagal menautkan Google';
      }
      return 'Koneksi ke server gagal';
    } catch (_) {
      return 'Terjadi kesalahan sistem';
    }
  }

  Future<String?> unlinkGoogle() async {
    try {
      final dio = await ApiClient.getInstance();
      await dio.post('/api/auth/unlink-google');
      await refreshMe();
      return null;
    } on DioException catch (e) {
      if (e.response?.data != null) {
        return e.response!.data['detail']?.toString() ?? 'Gagal melepas akun Google';
      }
      return 'Koneksi ke server gagal';
    } catch (_) {
      return 'Terjadi kesalahan sistem';
    }
  }

  Future<String> requestForgotPasswordOtp(String email) async {
    try {
      final dio = await ApiClient.getInstance();
      final res = await dio.post(
        '/api/auth/forgot-password/request',
        data: {'email': email.trim()},
      );
      return res.data['message']?.toString() ?? 'Kode OTP telah dikirim ke email';
    } on DioException catch (e) {
      if (e.response?.data != null) {
        throw e.response!.data['detail']?.toString() ?? 'Permintaan OTP gagal';
      }
      throw 'Koneksi ke server gagal';
    }
  }

  Future<String> resetPasswordWithOtp({
    required String email,
    required String otp,
    required String newPassword,
  }) async {
    try {
      final dio = await ApiClient.getInstance();
      final res = await dio.post(
        '/api/auth/forgot-password/reset',
        data: {
          'email': email.trim(),
          'otp_code': otp.trim(),
          'new_password': newPassword,
        },
      );
      return res.data['message']?.toString() ?? 'Kata sandi berhasil diatur ulang';
    } on DioException catch (e) {
      if (e.response?.data != null) {
        throw e.response!.data['detail']?.toString() ?? 'Reset kata sandi gagal';
      }
      throw 'Koneksi ke server gagal';
    }
  }

  Future<String> sendQrEmail({required String deviceId, required String claimCode}) async {
    try {
      final dio = await ApiClient.getInstance();
      final res = await dio.post(
        '/api/auth/send-qr-email',
        data: {
          'device_id': deviceId.trim(),
          'claim_code': claimCode.trim(),
        },
      );
      return res.data['message']?.toString() ?? 'QR perangkat berhasil dikirim ke email';
    } on DioException catch (e) {
      if (e.response?.data != null) {
        throw e.response!.data['detail']?.toString() ?? 'Gagal mengirim email QR';
      }
      throw 'Koneksi ke server gagal';
    }
  }

  Future<bool> verify2FA(String code) async {
    if (state.tempToken == null) return false;
    state = state.copyWith(isLoading: true, errorMessage: null);

    try {
      final dio = await ApiClient.getInstance();
      final res = await dio.post(
        '/api/auth/verify-2fa',
        data: {
          'temp_token': state.tempToken,
          'code': code.trim(),
        },
      );

      final data = res.data;
      final access = data['access_token'] as String;
      final refresh = data['refresh_token'] as String;
      final role = data['user']['role'] as String;
      final user = data['user']['username'] as String;

      await StorageService.setAccessToken(access);
      await StorageService.setRefreshToken(refresh);
      await StorageService.setUsername(user);
      await StorageService.setRole(role);

      state = AuthState(
        status: AuthStatus.authenticated,
        username: user,
        role: role,
        isLoading: false,
      );
      return true;
    } on DioException catch (e) {
      String msg = 'Verifikasi 2FA gagal';
      if (e.response?.data != null) {
        msg = e.response!.data['detail']?.toString() ?? msg;
      }
      state = state.copyWith(isLoading: false, errorMessage: msg);
      return false;
    } catch (_) {
      state = state.copyWith(isLoading: false, errorMessage: 'Terjadi kesalahan sistem.');
      return false;
    }
  }

  Future<void> logout() async {
    await StorageService.clearAuth();
    state = const AuthState(status: AuthStatus.unauthenticated);
  }
}

final authProvider = NotifierProvider<AuthNotifier, AuthState>(AuthNotifier.new);

class ThemeModeNotifier extends Notifier<String> {
  @override
  String build() {
    Future.microtask(() async {
      final mode = await StorageService.getThemeMode();
      state = mode;
    });
    return 'light';
  }

  Future<void> toggle() async {
    final next = state == 'light' ? 'dark' : 'light';
    state = next;
    await StorageService.setThemeMode(next);
  }

  Future<void> setMode(String mode) async {
    state = mode;
    await StorageService.setThemeMode(mode);
  }

  Future<void> setTheme(String mode) => setMode(mode);
}

final themeModeProvider = NotifierProvider<ThemeModeNotifier, String>(ThemeModeNotifier.new);
