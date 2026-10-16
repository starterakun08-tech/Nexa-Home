import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Sparkle,
  Microphone,
  MicrophoneSlash,
  PaperPlaneRight,
  Trash,
  SpeakerSlash,
} from '@phosphor-icons/react';
import { assistantApi, type AssistantHistoryItem } from '../api/assistant';
import { AppButton } from '../components/AppButton';
import { AppInput } from '../components/AppInput';
import { EmptyState } from '../components/EmptyState';
import styles from './AsistenPage.module.css';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  time: string;
  confirmation?: {
    id: string;
    details: string;
  };
}

const formatCurrentTime = (): string => {
  return new Date().toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

interface SoundwaveVisualizerProps {
  isListening: boolean;
  isPlayingTts: boolean;
}

const SoundwaveVisualizer: React.FC<SoundwaveVisualizerProps> = ({ isListening, isPlayingTts }) => {
  const bar0 = useRef<HTMLSpanElement>(null);
  const bar1 = useRef<HTMLSpanElement>(null);
  const bar2 = useRef<HTMLSpanElement>(null);
  const bar3 = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let animId: number;
    let stream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let isCancelled = false;

    // Nilai tinggi saat ini untuk interpolasi halus (lerp)
    const currentHeights = [5, 6, 6, 5];
    const targetHeights = [5, 6, 6, 5];

    const applyHeights = () => {
      if (bar0.current) bar0.current.style.height = `${Math.round(currentHeights[0])}px`;
      if (bar1.current) bar1.current.style.height = `${Math.round(currentHeights[1])}px`;
      if (bar2.current) bar2.current.style.height = `${Math.round(currentHeights[2])}px`;
      if (bar3.current) bar3.current.style.height = `${Math.round(currentHeights[3])}px`;
    };

    const renderLoop = () => {
      if (isCancelled) return;

      if (isListening && analyser) {
        const buffer = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(buffer);

        // Hitung total rata-rata amplitudo spektrum suara
        let total = 0;
        for (let i = 0; i < 16; i++) {
          total += buffer[i];
        }
        const avg = total / 16;

        if (avg > 7) {
          // Pengguna sedang bersuara: petakan ke 4 rentang frekuensi vokal
          const b0 = (buffer[1] + buffer[2]) / 2;
          const b1 = (buffer[3] + buffer[4] + buffer[5]) / 3;
          const b2 = (buffer[6] + buffer[7] + buffer[8]) / 3;
          const b3 = (buffer[9] + buffer[10] + buffer[11] + buffer[12]) / 4;

          targetHeights[0] = Math.min(18, Math.max(4, 4 + (b0 / 255) * 14));
          targetHeights[1] = Math.min(19, Math.max(4, 5 + (b1 / 255) * 14));
          targetHeights[2] = Math.min(19, Math.max(4, 5 + (b2 / 255) * 14));
          targetHeights[3] = Math.min(18, Math.max(4, 4 + (b3 / 255) * 14));
        } else {
          // Saat hening / diam: animasi idle breathing halus agar tidak kaku
          const t = performance.now() / 250;
          targetHeights[0] = 4 + Math.sin(t) * 1.5;
          targetHeights[1] = 5 + Math.sin(t + 1.2) * 2;
          targetHeights[2] = 5 + Math.sin(t + 2.4) * 2;
          targetHeights[3] = 4 + Math.sin(t + 3.6) * 1.5;
        }
      } else if (isPlayingTts) {
        // Output suara asisten: gelombang vokal responsif
        const t = performance.now() / 110;
        targetHeights[0] = 4 + Math.abs(Math.sin(t * 1.4)) * 11 + Math.cos(t * 0.8) * 2;
        targetHeights[1] = 5 + Math.abs(Math.sin(t * 1.7 + 0.6)) * 13;
        targetHeights[2] = 5 + Math.abs(Math.sin(t * 1.5 + 1.2)) * 13;
        targetHeights[3] = 4 + Math.abs(Math.sin(t * 1.9 + 1.8)) * 11;
      } else if (isListening) {
        // Fallback breathing jika stream mic belum siap
        const t = performance.now() / 250;
        targetHeights[0] = 4 + Math.sin(t) * 1.5;
        targetHeights[1] = 5 + Math.sin(t + 1.2) * 2;
        targetHeights[2] = 5 + Math.sin(t + 2.4) * 2;
        targetHeights[3] = 4 + Math.sin(t + 3.6) * 1.5;
      } else {
        targetHeights[0] = 4;
        targetHeights[1] = 5;
        targetHeights[2] = 5;
        targetHeights[3] = 4;
      }

      // Smooth exponential interpolation (lerp) 35% per frame
      for (let i = 0; i < 4; i++) {
        currentHeights[i] += (targetHeights[i] - currentHeights[i]) * 0.35;
      }

      applyHeights();
      animId = requestAnimationFrame(renderLoop);
    };

    if (isListening) {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices
          .getUserMedia({ audio: true })
          .then((s) => {
            if (isCancelled) {
              s.getTracks().forEach((track) => track.stop());
              return;
            }
            stream = s;
            try {
              const AudioContextClass =
                window.AudioContext || (window as any).webkitAudioContext;
              if (AudioContextClass) {
                audioCtx = new AudioContextClass();
                if (audioCtx.state === 'suspended') {
                  audioCtx.resume();
                }
                analyser = audioCtx.createAnalyser();
                analyser.fftSize = 128;
                analyser.smoothingTimeConstant = 0.5;
                source = audioCtx.createMediaStreamSource(s);
                source.connect(analyser);
              }
            } catch (err) {
              console.warn('AudioContext init error:', err);
            }
          })
          .catch((err) => {
            console.warn('Microphone stream access error:', err);
          });
      }
    }

    animId = requestAnimationFrame(renderLoop);

    return () => {
      isCancelled = true;
      cancelAnimationFrame(animId);

      if (source) {
        try {
          source.disconnect();
        } catch {}
      }
      if (analyser) {
        try {
          analyser.disconnect();
        } catch {}
      }
      if (audioCtx && audioCtx.state !== 'closed') {
        try {
          audioCtx.close();
        } catch {}
      }
      if (stream) {
        try {
          stream.getTracks().forEach((track) => track.stop());
        } catch {}
      }
    };
  }, [isListening, isPlayingTts]);

  return (
    <div className={styles.soundwave}>
      <span ref={bar0} className={styles.waveBar} />
      <span ref={bar1} className={styles.waveBar} />
      <span ref={bar2} className={styles.waveBar} />
      <span ref={bar3} className={styles.waveBar} />
    </div>
  );
};

export const AsistenPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputVal, setInputVal] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isPlayingTts, setIsPlayingTts] = useState(false);

  const recognitionRef = useRef<any>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  // Fetch initial history
  const { data: history = [] } = useQuery<AssistantHistoryItem[]>({
    queryKey: ['assistant-history'],
    queryFn: assistantApi.getHistory,
    refetchOnWindowFocus: false,
  });

  const historyLoadedRef = useRef(false);
  const handleSendMessageRef = useRef<((txt?: string) => Promise<void>) | null>(null);

  useEffect(() => {
    if (history.length > 0 && !historyLoadedRef.current) {
      historyLoadedRef.current = true;
      const initial: ChatMessage[] = history.map((h) => ({
        id: String(h.id),
        role: h.role,
        content: h.content,
        time: new Date(h.created_at).toLocaleTimeString('id-ID', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      }));
      setMessages(initial);
    }
  }, [history]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  // Inisialisasi Web Speech API (id-ID)
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRecognition) {
      const recognizer = new SpeechRecognition();
      recognizer.lang = 'id-ID';
      recognizer.continuous = false;
      recognizer.interimResults = false;

      recognizer.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        if (transcript) {
          setInputVal(transcript);
          handleSendMessageRef.current?.(transcript);
        }
        setIsListening(false);
      };

      recognizer.onerror = () => {
        setIsListening(false);
      };

      recognizer.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognizer;
    }
  }, []);

  const toggleMic = () => {
    if (!recognitionRef.current) {
      alert('Web Speech API tidak didukung oleh browser ini.');
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      stopSpeaking();
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch {
        setIsListening(false);
      }
    }
  };

  const stopSpeaking = () => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
      currentAudioRef.current = null;
      setIsPlayingTts(false);
    }
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
  };

  const playTtsAudio = async (text: string) => {
    try {
      stopSpeaking();
      const blob = await assistantApi.synthesizeTts(text.slice(0, 400));
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudioRef.current = audio;
      setIsPlayingTts(true);
      audio.onended = () => {
        setIsPlayingTts(false);
        URL.revokeObjectURL(url);
      };
      await audio.play();
    } catch {
      setIsPlayingTts(false);
    }
  };

  const handleSendMessage = async (textToSend?: string) => {
    const query = (textToSend || inputVal).trim();
    if (!query || isStreaming) return;

    setInputVal('');
    const nowTime = new Date().toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: query,
      time: nowTime,
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsStreaming(true);

    try {
      const res = await assistantApi.chat(query);
      const replyTime = new Date().toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      const botMsg: ChatMessage = {
        id: `bot-${Date.now()}`,
        role: 'assistant',
        content: res.reply || 'Perintah telah diproses.',
        time: replyTime,
        confirmation: (res.confirmation?.confirmation_id || res.confirmation_id)
          ? {
              id: (res.confirmation?.confirmation_id || res.confirmation_id)!,
              details: res.confirmation?.message || res.confirmation_details || res.reply,
            }
          : undefined,
      };

      setMessages((prev) => [...prev, botMsg]);
      queryClient.invalidateQueries({ queryKey: ['devices'] });

      // Mainkan suara jika ada balasan teks
      if (res.reply) {
        playTtsAudio(res.reply);
      }
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      const botMsg: ChatMessage = {
        id: `bot-${Date.now()}`,
        role: 'assistant',
        content: `Maaf, terjadi kesalahan: ${errObj.message || 'Gagal terhubung ke Nexa AI.'}`,
        time: nowTime,
      };
      setMessages((prev) => [...prev, botMsg]);
    } finally {
      setIsStreaming(false);
    }
  };

  useEffect(() => {
    handleSendMessageRef.current = handleSendMessage;
  });

  const handleConfirmAction = async (confirmationId: string, confirmed: boolean) => {
    try {
      const res = await assistantApi.confirmAction(confirmationId, confirmed);
      const updateTime = formatCurrentTime();

      setMessages((prev) => [
        ...prev,
        {
          id: `bot-${Date.now()}`,
          role: 'assistant',
          content: res.message || (confirmed ? 'Aksi telah dijalankan.' : 'Aksi dibatalkan.'),
          time: updateTime,
        },
      ]);
      queryClient.invalidateQueries({ queryKey: ['devices'] });
    } catch {
      // Handle error
    }
  };

  const handleClearHistory = async () => {
    await assistantApi.clearHistory();
    setMessages([]);
    stopSpeaking();
    queryClient.invalidateQueries({ queryKey: ['assistant-history'] });
  };

  return (
    <div className={styles.container}>
      {/* Header Info & Clear History */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
            Nexa AI Otomasi Nexa Home · MQTT ESP32
          </span>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {isPlayingTts && (
            <AppButton variant="outline" onClick={stopSpeaking}>
              <SpeakerSlash size={16} />
              <span>Hentikan Suara</span>
            </AppButton>
          )}
          {messages.length > 0 && (
            <AppButton variant="ghost" onClick={handleClearHistory} title="Hapus riwayat">
              <Trash size={16} />
              <span>Hapus Riwayat</span>
            </AppButton>
          )}
        </div>
      </div>

      {/* Chat Messages Canvas */}
      <div className={styles.chatCanvas}>
        <div className={styles.timestampDivider}>
          <div className={styles.dividerLine} />
          <span className={styles.dividerText}>Sesi Lokal Nexa Home · 2026</span>
          <div className={styles.dividerLine} />
        </div>

        {messages.length === 0 ? (
          <EmptyState
            icon={Sparkle}
            title="Ada yang bisa dibantu?"
            description="Ketik pesan atau gunakan suara untuk mengontrol lampu, kipas, memeriksa sensor gas, atau mencari barang."
          />
        ) : (
          messages.map((msg) => {
            if (msg.role === 'user') {
              return (
                <div key={msg.id} className={styles.userMsgContainer}>
                  <div className={styles.userBubble}>{msg.content}</div>
                  <span className={styles.msgTime}>{msg.time}</span>
                </div>
              );
            }

            return (
              <div key={msg.id} className={styles.botMsgContainer}>
                <div className={styles.botAvatar}>
                  <Sparkle size={18} />
                </div>
                <div className={styles.botBubbleGroup}>
                  <div className={styles.botBubble}>
                    <div>{msg.content}</div>

                    {/* Sensitive Action Card */}
                    {msg.confirmation && (
                      <div className={styles.confirmCard} style={{ marginTop: 'var(--space-3)' }}>
                        <div className={styles.confirmHeader}>
                          <span className={styles.dotWarn} />
                          <span>Konfirmasi Tindakan Sensitif</span>
                        </div>
                        <div className={styles.confirmBody}>{msg.confirmation.details}</div>
                        <div className={styles.confirmActions}>
                          <AppButton
                            variant="primary"
                            onClick={() => handleConfirmAction(msg.confirmation!.id, true)}
                          >
                            Ya, lanjutkan
                          </AppButton>
                          <AppButton
                            variant="outline"
                            onClick={() => handleConfirmAction(msg.confirmation!.id, false)}
                          >
                            Batal
                          </AppButton>
                        </div>
                      </div>
                    )}

                    <div className={styles.botMeta}>
                      <span className={styles.dotOk} />
                      <span>ESP32 / MQTT Lokal Terverifikasi</span>
                    </div>
                  </div>
                  <span className={styles.msgTime}>{msg.time}</span>
                </div>
              </div>
            );
          })
        )}
        <div ref={chatBottomRef} />
      </div>

      {/* Voice Status & Footer Area */}
      <div className={styles.footerArea}>
        {/* Voice Banner (Ketika Mendengarkan atau Nexa AI Memutar Suara) */}
        {(isListening || isPlayingTts) && (
          <div className={styles.voiceBanner}>
            <div className={styles.voiceLeft}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  backgroundColor: 'var(--color-accent-light)',
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-chip)',
                }}
              >
                <span className={styles.dotOk} />
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-xs)',
                    fontWeight: 600,
                    color: 'var(--color-accent)',
                  }}
                >
                  {isListening ? 'Mendengarkan…' : 'Berbicara…'}
                </span>
              </div>
              <SoundwaveVisualizer isListening={isListening} isPlayingTts={isPlayingTts} />
              <span className={styles.voiceNote}>
                {isListening ? 'Mikrofon perangkat ini aktif' : 'Nexa AI sedang memutar audio'}
              </span>
            </div>
            <AppButton variant="outline" onClick={isListening ? toggleMic : stopSpeaking}>
              {isListening ? <MicrophoneSlash size={16} /> : <SpeakerSlash size={16} />}
              <span>{isListening ? 'Berhenti bicara' : 'Hentikan suara'}</span>
            </AppButton>
          </div>
        )}

        {/* Form Input Pesan */}
        <form
          className={styles.inputRow}
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
        >
          <div style={{ flex: 1 }}>
            <AppInput
              placeholder="Ketik perintah atau gunakan suara..."
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              disabled={isStreaming}
            />
          </div>

          <AppButton
            type="button"
            variant="outline"
            onClick={toggleMic}
            title={isListening ? 'Matikan mikrofon' : 'Aktifkan mikrofon suara'}
            style={{
              borderColor: isListening ? 'var(--color-accent)' : undefined,
              backgroundColor: isListening ? 'var(--color-accent-light)' : undefined,
            }}
          >
            {isListening ? <MicrophoneSlash size={20} /> : <Microphone size={20} />}
          </AppButton>

          <AppButton type="submit" variant="primary" disabled={isStreaming || !inputVal.trim()}>
            <span>Kirim</span>
            <PaperPlaneRight size={18} />
          </AppButton>
        </form>

        {/* Quick Command Chips */}
        <div className={styles.quickChipsRow}>
          <span style={{ fontFamily: 'var(--font-mono)' }}>Perintah cepat:</span>
          <button
            type="button"
            className={styles.chipBtn}
            onClick={() => handleSendMessage('Status sensor gas')}
          >
            Status sensor gas
          </button>
          <button
            type="button"
            className={styles.chipBtn}
            onClick={() => handleSendMessage('Matikan lampu tamu')}
          >
            Matikan lampu tamu
          </button>
          <button
            type="button"
            className={styles.chipBtn}
            onClick={() => handleSendMessage('Nyalakan kipas')}
          >
            Nyalakan kipas
          </button>
          <span className={styles.privacyNotice}>
            * Audio mikrofon diproses oleh Web Speech API browser
          </span>
        </div>
      </div>
    </div>
  );
};
