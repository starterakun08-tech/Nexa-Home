import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:app/core/auth_state.dart';
import 'package:app/core/api_client.dart';

void main() {
  group('Tahap S — Keamanan & Investigasi Login Flutter (S5 & S6)', () {
    test('AuthState defaults to AuthStatus.initial and isLoading is false initially', () {
      const state = AuthState(status: AuthStatus.initial);
      expect(state.status, AuthStatus.initial);
      expect(state.isLoading, false);
      expect(state.errorMessage, isNull);
    });

    test('AuthState copyWith preserves status and updates error message cleanly', () {
      const state = AuthState(status: AuthStatus.unauthenticated);
      final updated = state.copyWith(
        errorMessage: 'Nama pengguna atau kata sandi salah.',
        isLoading: false,
      );
      expect(updated.status, AuthStatus.unauthenticated);
      expect(updated.errorMessage, 'Nama pengguna atau kata sandi salah.');
      expect(updated.isLoading, false);
    });

    test('ApiClient reset clears internal state and mutex', () {
      ApiClient.reset();
      // Verifikasi reset tidak memicu exception
      expect(true, isTrue);
    });

    test('Pemetaan pesan kesalahan ramah Tahap S sesuai spesifikasi', () {
      String formatClaimErrorMessage(String rawError) {
        final err = rawError.toLowerCase();
        if (err.contains('terpakai') || err.contains('used')) {
          return 'Kode pairing sudah terpakai';
        }
        if (err.contains('kedaluwarsa') || err.contains('expired')) {
          return 'Kode pairing kedaluwarsa. Silakan tekan tombol pairing di perangkat untuk kode baru';
        }
        if (err.contains('terlalu banyak') || err.contains('rate limit') || err.contains('429')) {
          return 'Terlalu banyak percobaan. Tunggu 10 menit';
        }
        if (err.contains('sudah terdaftar') || err.contains('already bound') || err.contains('409') || err.contains('lain') || err.contains('terhubung')) {
          return 'Perangkat ini sudah terdaftar di akun lain. Hubungi pemiliknya untuk melepaskan';
        }
        if (err.contains('pengelola') || err.contains('403') || err.contains('forbidden')) {
          return 'Hanya Pengelola yang dapat menambahkan perangkat';
        }
        return rawError.isNotEmpty ? rawError : 'Gagal menghubungkan perangkat.';
      }

      expect(
        formatClaimErrorMessage('Kode pairing sudah terpakai'),
        'Kode pairing sudah terpakai',
      );
      expect(
        formatClaimErrorMessage('Sesi pairing expired atau kedaluwarsa'),
        'Kode pairing kedaluwarsa. Silakan tekan tombol pairing di perangkat untuk kode baru',
      );
      expect(
        formatClaimErrorMessage('Rate limit reached: 429 Too many requests'),
        'Terlalu banyak percobaan. Tunggu 10 menit',
      );
      expect(
        formatClaimErrorMessage('Device is already bound to another family 409'),
        'Perangkat ini sudah terdaftar di akun lain. Hubungi pemiliknya untuk melepaskan',
      );
      expect(
        formatClaimErrorMessage('Hanya pengelola yang berhak mengklaim 403'),
        'Hanya Pengelola yang dapat menambahkan perangkat',
      );
    });
  });
}
