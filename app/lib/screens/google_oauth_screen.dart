import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:app/theme/tokens.dart';
import 'package:app/components/app_toast.dart';

class GoogleOAuthScreen extends StatefulWidget {
  final String initialUrl;

  const GoogleOAuthScreen({super.key, required this.initialUrl});

  static Future<String?> show(BuildContext context, String initialUrl) {
    return Navigator.of(context).push<String>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => GoogleOAuthScreen(initialUrl: initialUrl),
      ),
    );
  }

  @override
  State<GoogleOAuthScreen> createState() => _GoogleOAuthScreenState();
}

class _GoogleOAuthScreenState extends State<GoogleOAuthScreen> {
  late final WebViewController _controller;
  int _progress = 0;
  bool _isLoading = true;
  bool _popped = false;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setUserAgent(
        'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
      )
      ..setNavigationDelegate(
        NavigationDelegate(
          onProgress: (int progress) {
            if (mounted) setState(() => _progress = progress);
          },
          onPageStarted: (String url) {
            if (mounted) setState(() => _isLoading = true);
            _checkCallback(url);
          },
          onPageFinished: (String url) {
            if (mounted) setState(() => _isLoading = false);
            _checkCallback(url);
          },
          onNavigationRequest: (NavigationRequest request) {
            if (_checkCallback(request.url)) {
              return NavigationDecision.prevent;
            }
            return NavigationDecision.navigate;
          },
        ),
      )
      ..loadRequest(Uri.parse(widget.initialUrl));
  }

  bool _checkCallback(String url) {
    if (_popped) return false;
    final uri = Uri.tryParse(url);
    if (uri == null) return false;

    final code = uri.queryParameters['code'];
    if (code != null && code.isNotEmpty) {
      _popped = true;
      Navigator.of(context).pop(code);
      return true;
    }
    return false;
  }

  Future<void> _openInExternalBrowser() async {
    final uri = Uri.parse(widget.initialUrl);
    try {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (mounted) {
        AppToast.show(context, 'Membuka di peramban sistem...');
      }
    } catch (e) {
      if (mounted) {
        AppToast.show(context, 'Gagal membuka peramban: $e', isError: true);
      }
    }
  }

  void _showManualCodeInput() {
    final textController = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) {
        final isDark = Theme.of(ctx).brightness == Brightness.dark;
        return AlertDialog(
          backgroundColor: isDark ? AppColors.darkSurface : AppColors.lightSurface,
          title: Text(
            'Tempel Kode atau URL',
            style: AppTypography.body(
              isDark ? AppColors.darkText : AppColors.lightText,
              size: AppTypography.textMd,
              weight: FontWeight.w600,
            ),
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'Jika Anda login di peramban eksternal, salin tautan atau kode dari bilah alamat browser lalu tempelkan di sini:',
                style: AppTypography.body(
                  isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary,
                  size: AppTypography.textSm,
                ),
              ),
              const SizedBox(height: AppSpacing.space3),
              TextField(
                controller: textController,
                decoration: const InputDecoration(
                  hintText: 'https://aujasena.my.id/login?code=4/...',
                  border: OutlineInputBorder(),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Batal'),
            ),
            ElevatedButton(
              onPressed: () {
                final raw = textController.text.trim();
                Navigator.of(ctx).pop();
                if (raw.isNotEmpty) {
                  final uri = Uri.tryParse(raw);
                  final code = uri?.queryParameters['code'] ?? raw;
                  if (code.isNotEmpty && mounted && !_popped) {
                    _popped = true;
                    Navigator.of(context).pop(code);
                  }
                }
              },
              child: const Text('Gunakan Kode'),
            ),
          ],
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bg = isDark ? AppColors.darkBg : AppColors.lightBg;
    final surface = isDark ? AppColors.darkSurface : AppColors.lightSurface;
    final text = isDark ? AppColors.darkText : AppColors.lightText;

    return Scaffold(
      backgroundColor: bg,
      appBar: AppBar(
        backgroundColor: surface,
        elevation: 0,
        leading: IconButton(
          icon: Icon(PhosphorIconsRegular.x, color: text),
          onPressed: () => Navigator.of(context).pop(),
        ),
        title: Row(
          children: [
            const Icon(PhosphorIconsRegular.googleLogo, color: Color(0xFF4285F4), size: 20),
            const SizedBox(width: AppSpacing.space2),
            Text(
              'Masuk dengan Google',
              style: AppTypography.body(
                text,
                size: AppTypography.textMd,
                weight: FontWeight.w600,
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Buka di Browser Chrome',
            icon: Icon(PhosphorIconsRegular.arrowSquareOut, color: text),
            onPressed: _openInExternalBrowser,
          ),
          IconButton(
            tooltip: 'Tempel Kode Manual',
            icon: Icon(PhosphorIconsRegular.clipboardText, color: text),
            onPressed: _showManualCodeInput,
          ),
        ],
        bottom: _isLoading
            ? PreferredSize(
                preferredSize: const Size.fromHeight(2),
                child: LinearProgressIndicator(
                  value: _progress > 0 ? _progress / 100.0 : null,
                  backgroundColor: AppColors.transparent,
                  valueColor: const AlwaysStoppedAnimation<Color>(Color(0xFF4285F4)),
                ),
              )
            : null,
      ),
      body: WebViewWidget(controller: _controller),
    );
  }
}
