import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:app/core/auth_state.dart';
import 'package:app/screens/add_camera_screen.dart';
import 'package:app/screens/add_device/choose_type_screen.dart';
import 'package:app/screens/add_device/esp32_error_screen.dart';
import 'package:app/screens/add_device/esp32_qr_scan_screen.dart';
import 'package:app/screens/add_device/esp32_step1_code_screen.dart';
import 'package:app/screens/add_device/esp32_step2_connect_wifi_screen.dart';
import 'package:app/screens/add_device/esp32_step3_wifi_setup_screen.dart';
import 'package:app/screens/add_device/esp32_step4_connecting_screen.dart';
import 'package:app/screens/add_device/esp32_success_screen.dart';
import 'package:app/screens/all_devices_screen.dart';
import 'package:app/screens/channel_admin_screen.dart';
import 'package:app/screens/design_screen.dart';
import 'package:app/screens/family_summary_screen.dart';
import 'package:app/screens/login_screen.dart';
import 'package:app/screens/manage_members_screen.dart';
import 'package:app/screens/notifications_screen.dart';
import 'package:app/screens/settings_screen.dart';
import 'package:app/screens/setup_wizard_screen.dart';
import 'package:app/screens/shell_screen.dart';
import 'package:app/screens/verify_2fa_screen.dart';

final routerProvider = Provider<GoRouter>((ref) {
  final auth = ref.watch(authProvider);

  return GoRouter(
    initialLocation: '/login',
    redirect: (BuildContext context, GoRouterState state) {
      final loc = state.matchedLocation;

      if (auth.status == AuthStatus.initial) {
        if (loc == '/' || loc.startsWith('/family') || loc.startsWith('/device') || loc.startsWith('/all-devices')) {
          return '/login';
        }
        return null;
      }

      if (auth.status == AuthStatus.needsSetup) {
        if (loc != '/setup') return '/setup';
        return null;
      }

      if (auth.status == AuthStatus.twoFactorPending) {
        if (loc != '/verify-2fa') return '/verify-2fa';
        return null;
      }

      if (auth.status == AuthStatus.unauthenticated) {
        if (loc != '/login' && loc != '/setup' && loc != '/settings') return '/login';
        return null;
      }

      if (auth.status == AuthStatus.authenticated) {
        if (loc == '/login' || loc == '/setup' || loc == '/verify-2fa') return '/';
      }

      return null;
    },
    routes: [
      GoRoute(
        path: '/',
        builder: (context, state) => const ShellScreen(),
      ),
      GoRoute(
        path: '/login',
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        path: '/setup',
        builder: (context, state) => const SetupWizardScreen(),
      ),
      GoRoute(
        path: '/verify-2fa',
        builder: (context, state) => const Verify2FAScreen(),
      ),
      GoRoute(
        path: '/settings',
        builder: (context, state) => const SettingsScreen(),
      ),
      GoRoute(
        path: '/notifications',
        builder: (context, state) => const NotificationsScreen(),
      ),
      GoRoute(
        path: '/all-devices',
        builder: (context, state) => const AllDevicesScreen(),
      ),
      GoRoute(
        path: '/family-summary',
        builder: (context, state) => const FamilySummaryScreen(),
      ),
      GoRoute(
        path: '/manage-members',
        builder: (context, state) => const ManageMembersScreen(),
      ),
      GoRoute(
        path: '/add-device',
        builder: (context, state) => const ChooseDeviceTypeScreen(),
      ),
      GoRoute(
        path: '/add-camera',
        builder: (context, state) => const AddCameraScreen(),
      ),
      GoRoute(
        path: '/esp32-step1',
        builder: (context, state) => const Esp32Step1CodeScreen(),
      ),
      GoRoute(
        path: '/esp32-step2',
        builder: (context, state) => const Esp32Step2ConnectWifiScreen(),
      ),
      GoRoute(
        path: '/esp32-qr',
        builder: (context, state) => const Esp32QrScanScreen(),
      ),
      GoRoute(
        path: '/esp32-step3',
        builder: (context, state) => const Esp32Step3WifiSetupScreen(),
      ),
      GoRoute(
        path: '/esp32-step4',
        builder: (context, state) => const Esp32Step4ConnectingScreen(),
      ),
      GoRoute(
        path: '/esp32-success',
        builder: (context, state) => const Esp32SuccessScreen(),
      ),
      GoRoute(
        path: '/esp32-error',
        builder: (context, state) => const Esp32ErrorScreen(),
      ),
      GoRoute(
        path: '/design',
        builder: (context, state) => const DesignScreen(),
      ),
      GoRoute(
        path: '/channel-admin',
        builder: (context, state) => const ChannelAdminScreen(),
      ),
    ],
  );
});

