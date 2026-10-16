import 'dart:async';
import 'package:dio/dio.dart';
import 'package:app/core/storage.dart';

class ApiClient {
  static Dio? _dio;
  static String? _currentBaseUrl;
  static Completer<String?>? _refreshCompleter;

  static Future<Dio> getInstance() async {
    final serverUrl = await StorageService.getServerUrl();
    if (_dio == null || _currentBaseUrl != serverUrl) {
      _currentBaseUrl = serverUrl;
      _dio = Dio(
        BaseOptions(
          baseUrl: serverUrl,
          connectTimeout: const Duration(seconds: 10),
          receiveTimeout: const Duration(seconds: 10),
          sendTimeout: const Duration(seconds: 10),
          headers: {'Content-Type': 'application/json'},
        ),
      );

      _dio!.interceptors.add(
        InterceptorsWrapper(
          onRequest: (options, handler) async {
            final token = await StorageService.getAccessToken();
            if (token != null && token.isNotEmpty) {
              options.headers['Authorization'] = 'Bearer $token';
            }
            return handler.next(options);
          },
          onError: (DioException error, handler) async {
            // 1. Tangani 401 Unauthorized via Refresh Token dengan mutex single-flight (S6)
            if (error.response?.statusCode == 401 && error.requestOptions.path != '/api/auth/refresh') {
              final refreshToken = await StorageService.getRefreshToken();
              if (refreshToken != null && refreshToken.isNotEmpty) {
                String? newAccessToken;
                if (_refreshCompleter != null) {
                  // Tunggu proses refresh yang sedang berjalan (mencegah balapan token rotasi)
                  newAccessToken = await _refreshCompleter!.future;
                } else {
                  _refreshCompleter = Completer<String?>();
                  try {
                    final refreshDio = Dio(BaseOptions(
                      baseUrl: _currentBaseUrl ?? serverUrl,
                      connectTimeout: const Duration(seconds: 5),
                      receiveTimeout: const Duration(seconds: 5),
                      sendTimeout: const Duration(seconds: 5),
                    ));
                    final refreshRes = await refreshDio.post(
                      '/api/auth/refresh',
                      data: {'refresh_token': refreshToken},
                    );
                    if (refreshRes.statusCode == 200) {
                      final newAccess = refreshRes.data['access_token'] as String;
                      await StorageService.setAccessToken(newAccess);
                      final newRefresh = refreshRes.data['refresh_token'] as String?;
                      if (newRefresh != null && newRefresh.isNotEmpty) {
                        await StorageService.setRefreshToken(newRefresh);
                      }
                      newAccessToken = newAccess;
                      _refreshCompleter!.complete(newAccess);
                    } else {
                      _refreshCompleter!.complete(null);
                      await StorageService.clearAuth();
                    }
                  } catch (_) {
                    _refreshCompleter!.complete(null);
                    await StorageService.clearAuth();
                  } finally {
                    _refreshCompleter = null;
                  }
                }

                if (newAccessToken != null && newAccessToken.isNotEmpty) {
                  error.requestOptions.headers['Authorization'] = 'Bearer $newAccessToken';
                  try {
                    final retryRes = await _dio!.fetch(error.requestOptions);
                    return handler.resolve(retryRes);
                  } catch (_) {}
                }
              }
            }

            // 2. Fallback otomatis ke URL kandidat jika koneksi timeout atau host tidak terjangkau (S6)
            final isConnectionIssue = error.type == DioExceptionType.connectionTimeout ||
                error.type == DioExceptionType.connectionError ||
                error.type == DioExceptionType.sendTimeout ||
                error.type == DioExceptionType.receiveTimeout;

            if (isConnectionIssue && error.requestOptions.extra['retried_fallback'] != true) {
              final candidates = StorageService.candidateServerUrls
                  .where((c) => c != _currentBaseUrl)
                  .toList();

              for (final candidate in candidates) {
                try {
                  final checkDio = Dio(BaseOptions(
                    baseUrl: candidate,
                    connectTimeout: const Duration(milliseconds: 1500),
                    receiveTimeout: const Duration(milliseconds: 1500),
                  ));
                  final check = await checkDio.get('/api/health');
                  if (check.statusCode == 200) {
                    await StorageService.setServerUrl(candidate);
                    _currentBaseUrl = candidate;
                    _dio!.options.baseUrl = candidate;

                    final newReqOptions = error.requestOptions;
                    newReqOptions.baseUrl = candidate;
                    newReqOptions.extra['retried_fallback'] = true;
                    final retryRes = await _dio!.fetch(newReqOptions);
                    return handler.resolve(retryRes);
                  }
                } catch (_) {}
              }
            }

            return handler.next(error);
          },
        ),
      );
    }
    return _dio!;
  }

  static void reset() {
    _dio = null;
    _currentBaseUrl = null;
    _refreshCompleter = null;
  }
}
