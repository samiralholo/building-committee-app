import { ChangeDetectionStrategy, Component, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import QRCode from 'qrcode';
import { slugify } from '../../core/format';
import { copyText, publicBuildingUrl } from '../../core/messages';
import { EmergencyContact } from '../../core/models';
import { isValidPhone, normalizePhone } from '../../core/phone';
import { ToastService, arabicError } from '../../core/toast.service';
import { Icon } from '../../shared/icon';
import { AdminStore } from './admin-store';

const ROLE_SUGGESTIONS = ['مشرف البناء', 'سبّاك', 'كهربجي', 'فني المصعد', 'حارس البناء', 'تنظيف'];

@Component({
  selector: 'app-settings',
  imports: [FormsModule, RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!store.building()) {
      <div class="card p-8 text-center">
        <p class="text-lg font-bold">أنشئ البناء أولاً</p>
        <a routerLink="/admin" class="btn-primary mt-4">للرئيسية</a>
      </div>
    } @else {
      <form class="space-y-5 pb-24" (ngSubmit)="save()">
        <!-- Public link + QR -->
        <section class="card space-y-3 p-4">
          <h2 class="flex items-center gap-2 text-lg font-extrabold"><app-icon name="qr" /> رابط السكان و QR للمصعد</h2>
          <div class="flex items-center gap-2 rounded-xl bg-page p-2 ps-3">
            <span class="min-w-0 flex-1 truncate text-start font-semibold" dir="ltr">{{ publicUrl() }}</span>
            <button type="button" class="btn-secondary" (click)="copyLink()"><app-icon name="copy" [size]="18" /> نسخ</button>
          </div>
          @if (qr()) {
            <div class="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
              <img [src]="qr()" alt="QR code لصفحة البناء" class="size-48 rounded-xl ring-1 ring-line" />
              <div class="w-full space-y-2 sm:flex-1">
                <p class="text-ink-soft">اطبع الكود والزقه بالمصعد. أي ساكن بيمسحه بالكاميرا بيفتح صفحة البناء، وبيقدر يضيفها لشاشة تلفونه.</p>
                <button type="button" class="btn-primary w-full" (click)="printPoster()"><app-icon name="printer" /> طباعة ورقة المصعد</button>
                <a class="btn-secondary w-full" [href]="qr()" [download]="'qr-' + store.building()!.slug + '.png'">
                  <app-icon name="download" /> تنزيل صورة الـ QR
                </a>
              </div>
            </div>
          }
        </section>

        <!-- Basics -->
        <section class="card space-y-4 p-4">
          <h2 class="text-lg font-extrabold">معلومات البناء</h2>
          <div>
            <label class="label" for="s-name">اسم البناء</label>
            <input id="s-name" name="name" class="field" required [(ngModel)]="name" />
          </div>
          <div>
            <label class="label" for="s-slug">رمز البناء (بالرابط)</label>
            <input id="s-slug" name="slug" class="field text-start" dir="ltr" required [(ngModel)]="slug" (blur)="slug = slugify(slug)" />
            @if (slugify(slug) !== store.building()!.slug) {
              <p class="mt-1 text-sm font-semibold text-partial">⚠️ إذا غيّرت الرمز، الـ QR القديم والرابط القديم ما عاد يشتغلوا.</p>
            }
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="label" for="s-fee">الاشتراك الشهري</label>
              <input id="s-fee" name="fee" type="number" inputmode="decimal" min="0" class="field num" [(ngModel)]="fee" />
            </div>
            <div>
              <label class="label" for="s-cur">العملة</label>
              <input id="s-cur" name="currency" class="field" list="currencies" [(ngModel)]="currency" />
              <datalist id="currencies">
                <option value="ل.س"></option>
                <option value="$"></option>
                <option value="ل.ل"></option>
                <option value="د.أ"></option>
                <option value="ر.س"></option>
                <option value="ج.م"></option>
              </datalist>
            </div>
          </div>
          <div class="flex min-h-12 items-center justify-between gap-3 rounded-xl bg-page px-4 py-2">
            <div>
              <p class="font-bold">إخفاء أسماء السكان</p>
              <p class="text-sm text-ink-soft">بالصفحة العامة بيظهر اسم الشقة والطابق بس</p>
            </div>
            <button
              type="button"
              class="toggle"
              role="switch"
              [attr.aria-checked]="hideNames"
              aria-label="إخفاء أسماء السكان"
              (click)="hideNames = !hideNames"
            >
              <span class="toggle-knob"></span>
            </button>
          </div>
        </section>

        <!-- Announcement -->
        <section class="card space-y-3 p-4">
          <h2 class="flex items-center gap-2 text-lg font-extrabold"><app-icon name="megaphone" /> إعلان مثبّت للسكان</h2>
          <textarea
            name="announcement"
            rows="3"
            class="field min-h-24"
            placeholder="مثلاً: تنظيف خزان المياه يوم الجمعة الصبح"
            [(ngModel)]="announcement"
          ></textarea>
          @if (announcement) {
            <button type="button" class="btn-ghost" (click)="announcement = ''"><app-icon name="x" [size]="18" /> شيل الإعلان</button>
          }
        </section>

        <!-- Emergency contacts -->
        <section class="card space-y-3 p-4">
          <div class="flex items-center justify-between gap-2">
            <h2 class="flex items-center gap-2 text-lg font-extrabold"><app-icon name="phone" /> أرقام الطوارئ</h2>
            <button type="button" class="btn-secondary" (click)="addContact()"><app-icon name="plus" [size]="18" /> إضافة</button>
          </div>
          <datalist id="roles">
            @for (r of roles; track r) {
              <option [value]="r"></option>
            }
          </datalist>
          @for (c of contacts(); track $index; let i = $index) {
            <div class="space-y-2 rounded-xl bg-page p-3">
              <div class="grid grid-cols-2 gap-2">
                <input class="field" [name]="'c-role-' + i" list="roles" placeholder="الصفة (سبّاك…)" [(ngModel)]="c.role" />
                <input class="field" [name]="'c-name-' + i" placeholder="الاسم" [(ngModel)]="c.name" />
              </div>
              <div class="flex gap-2">
                <input
                  class="field num flex-1 text-start"
                  [name]="'c-phone-' + i"
                  type="tel"
                  dir="ltr"
                  placeholder="0933 123 456"
                  [(ngModel)]="c.phone"
                  (blur)="c.phone = normalize(c.phone)"
                />
                <button type="button" class="btn-icon text-unpaid" aria-label="حذف الرقم" (click)="removeContact(i)">
                  <app-icon name="trash" />
                </button>
              </div>
            </div>
          } @empty {
            <p class="text-ink-soft">ما في أرقام. أضف رقم السبّاك والكهربجي وفني المصعد.</p>
          }
        </section>

        <div class="fixed inset-x-0 bottom-16 z-20 border-t border-line bg-white/95 p-3 backdrop-blur lg:bottom-0">
          <div class="mx-auto max-w-5xl">
            <button type="submit" class="btn-primary w-full text-lg" [disabled]="saving()">
              {{ saving() ? 'جاري الحفظ…' : 'حفظ الإعدادات' }}
            </button>
          </div>
        </div>
      </form>
    }
  `,
})
export class Settings {
  protected readonly store = inject(AdminStore);
  private readonly toast = inject(ToastService);

  protected readonly slugify = slugify;
  protected readonly normalize = normalizePhone;
  protected readonly roles = ROLE_SUGGESTIONS;

  protected readonly saving = signal(false);
  protected readonly qr = signal<string>('');
  protected readonly publicUrl = signal('');
  protected readonly contacts = signal<EmergencyContact[]>([]);

  protected name = '';
  protected slug = '';
  protected fee = 0;
  protected currency = '';
  protected hideNames = false;
  protected announcement = '';

  constructor() {
    // Load form values whenever the active building changes (or after save).
    effect(() => {
      const b = this.store.building();
      if (!b) return;
      untracked(() => {
        this.name = b.name;
        this.slug = b.slug;
        this.fee = Number(b.default_monthly_fee);
        this.currency = b.currency;
        this.hideNames = b.hide_resident_names;
        this.announcement = b.announcement ?? '';
        this.contacts.set(b.emergency_contacts.map((c) => ({ ...c })));
        const url = publicBuildingUrl(b.slug);
        this.publicUrl.set(url);
        void this.renderQr(url);
      });
    });
  }

  private async renderQr(url: string): Promise<void> {
    try {
      this.qr.set(
        await QRCode.toDataURL(url, {
          width: 720,
          margin: 2,
          errorCorrectionLevel: 'M',
          color: { dark: '#0F766E', light: '#FFFFFF' },
        }),
      );
    } catch {
      this.qr.set('');
    }
  }

  protected addContact(): void {
    this.contacts.update((list) => [...list, { name: '', role: '', phone: '' }]);
  }

  protected removeContact(i: number): void {
    this.contacts.update((list) => list.filter((_, idx) => idx !== i));
  }

  protected async copyLink(): Promise<void> {
    try {
      await copyText(this.publicUrl());
      this.toast.success('تم نسخ الرابط ✓');
    } catch {
      this.toast.error('ما قدرنا ننسخ');
    }
  }

  protected printPoster(): void {
    const b = this.store.building();
    if (!b || !this.qr()) return;
    const w = window.open('', '_blank', 'width=800,height=1000');
    if (!w) {
      this.toast.error('اسمح بالنوافذ المنبثقة للطباعة');
      return;
    }
    const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
    w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(b.name)}</title>
      <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@600;800&display=swap" rel="stylesheet">
      <style>
        body{font-family:Cairo,system-ui,sans-serif;text-align:center;color:#1E293B;margin:0;padding:48px 32px}
        h1{font-size:40px;font-weight:800;margin:0 0 8px} h2{font-size:28px;color:#0F766E;margin:0 0 24px}
        img{width:420px;height:420px} p{font-size:24px;margin:16px 0} .url{direction:ltr;font-size:20px;color:#475569}
        .box{border:4px solid #0F766E;border-radius:32px;padding:32px;max-width:640px;margin:0 auto}
      </style></head><body><div class="box">
      <h1>${esc(b.name)}</h1><h2>صندوق البناء 🏢</h2>
      <img src="${this.qr()}" alt="QR">
      <p>📱 امسح الكود بكاميرا التلفون</p>
      <p>شوف مين دفع، المصاريف والفواتير، وأرقام الطوارئ</p>
      <p class="url">${esc(this.publicUrl())}</p>
      </div><script>window.onload=function(){setTimeout(function(){window.print()},400)}</script></body></html>`);
    w.document.close();
  }

  protected async save(): Promise<void> {
    const slug = slugify(this.slug);
    if (!this.name.trim() || slug.length < 3) {
      this.toast.error('اكتب اسم البناء ورمز من 3 أحرف على الأقل');
      return;
    }
    const contacts = this.contacts()
      .map((c) => ({ name: c.name.trim(), role: c.role.trim(), phone: normalizePhone(c.phone) }))
      .filter((c) => c.name || c.phone);
    const bad = contacts.find((c) => !isValidPhone(c.phone));
    if (bad) {
      this.toast.error(`رقم "${bad.name || bad.role}" غير صحيح`);
      return;
    }
    this.saving.set(true);
    try {
      await this.store.updateBuilding({
        name: this.name.trim(),
        slug,
        default_monthly_fee: Math.max(0, Number(this.fee) || 0),
        currency: this.currency.trim() || 'ل.س',
        hide_resident_names: this.hideNames,
        announcement: this.announcement.trim() || null,
        emergency_contacts: contacts,
      });
      this.toast.success('تم حفظ الإعدادات ✓');
    } catch (err) {
      this.toast.error(arabicError(err, 'ما انحفظت الإعدادات'));
    } finally {
      this.saving.set(false);
    }
  }
}
