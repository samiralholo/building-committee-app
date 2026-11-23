import { Injectable, signal } from '@angular/core';

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private nextId = 1;
  readonly toasts = signal<Toast[]>([]);

  success(message: string): void {
    this.show('success', message);
  }

  error(message: string): void {
    this.show('error', message, 5000);
  }

  info(message: string): void {
    this.show('info', message);
  }

  dismiss(id: number): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }

  private show(kind: ToastKind, message: string, duration = 3000): void {
    const id = this.nextId++;
    this.toasts.update((list) => [...list.slice(-2), { id, kind, message }]);
    setTimeout(() => this.dismiss(id), duration);
  }
}

/** Turns any thrown value into a short, friendly Arabic message. */
export function arabicError(err: unknown, fallback = 'صار خطأ، جرّب مرة ثانية'): string {
  const raw =
    typeof err === 'object' && err !== null && 'message' in err ? String((err as { message: unknown }).message) : '';
  const msg = raw.toLowerCase();
  if (!raw) return fallback;
  if (msg.includes('invalid login credentials')) return 'البريد أو كلمة السر غير صحيحة';
  if (msg.includes('email not confirmed')) return 'لازم تأكيد البريد الإلكتروني أولاً';
  if (msg.includes('failed to fetch') || msg.includes('network')) return 'ما في اتصال بالإنترنت';
  if (msg.includes('duplicate key') && msg.includes('slug')) return 'رمز البناء مستخدم من قبل، اختر رمز ثاني';
  if (msg.includes('buildings_slug_check') || msg.includes('slug')) return 'رمز البناء لازم يكون حروف إنجليزية صغيرة وأرقام وشرطات فقط';
  if (msg.includes('whatsapp_phone')) return 'رقم الواتساب غير صحيح (أرقام فقط مع رمز الدولة)';
  if (msg.includes('row-level security') || msg.includes('not allowed') || msg.includes('permission'))
    return 'ما عندك صلاحية لهالعملية';
  if (msg.includes('not-configured')) return 'التطبيق غير مربوط بقاعدة البيانات بعد';
  return fallback;
}
