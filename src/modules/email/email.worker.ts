import { EmailRepository } from './email.repository';
import { SenderDomainRepository } from './sender-domain.repository';
import { VisitorRepository } from '../visitor/visitor.repository';
import { ChatRepository } from '../chat/chat.repository';
import { MerchantRepository } from '../merchant/merchant.repository';
import { getEmailProvider } from '../../providers/email';
import { getPurchaseAdapter } from '../../providers/purchase';
import { getDatabaseClient, IDatabaseClient } from '../../database/client';

export class EmailWorker {
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  
  private db: IDatabaseClient;
  private emailRepo: EmailRepository;
  private senderDomainRepo: SenderDomainRepository;
  private visitorRepo: VisitorRepository;
  private chatRepo: ChatRepository;
  private merchantRepo: MerchantRepository;

  constructor(deps?: {
    db?: IDatabaseClient;
    emailRepo?: EmailRepository;
    senderDomainRepo?: SenderDomainRepository;
    visitorRepo?: VisitorRepository;
    chatRepo?: ChatRepository;
    merchantRepo?: MerchantRepository;
  }) {
    this.db = deps?.db || getDatabaseClient();
    this.emailRepo = deps?.emailRepo || new EmailRepository(this.db);
    this.senderDomainRepo = deps?.senderDomainRepo || new SenderDomainRepository(this.db);
    this.visitorRepo = deps?.visitorRepo || new VisitorRepository(this.db);
    this.chatRepo = deps?.chatRepo || new ChatRepository(this.db);
    this.merchantRepo = deps?.merchantRepo || new MerchantRepository(this.db);
  }

  start() {
    if (this.isRunning) return;
    const intervalMs = parseInt(process.env.EMAIL_WORKER_INTERVAL_MS || '60000', 10);
    
    this.isRunning = true;
    this.timer = setInterval(() => this.processPendingJobs(), intervalMs);
    console.log(`[EmailWorker] Started with interval ${intervalMs}ms`);
  }

  stop() {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async processPendingJobs() {
    try {
      const jobs = await this.emailRepo.getPendingJobs(undefined, 50);
      
      for (const job of jobs) {
        try {
          await this.processJob(job);
        } catch (err: any) {
          console.error(`[EmailWorker] Job ${job.id} failed:`, err);
          await this.emailRepo.updateJobStatus(job.id, 'failed', { errorMsg: err.message });
        }
      }
    } catch (err) {
      console.error('[EmailWorker] Failed to process jobs', err);
    }
  }

  private async processJob(job: any) {
    const store = await this.merchantRepo.getStoreById(job.store_id);
    if (!store) {
      return this.emailRepo.updateJobStatus(job.id, 'cancelled', { cancelReason: 'Store not found' });
    }

    const visitor = await this.visitorRepo.getVisitorById(job.store_id, job.visitor_id);
    if (!visitor || !visitor.email) {
      return this.emailRepo.updateJobStatus(job.id, 'cancelled', { cancelReason: 'No email found for visitor' });
    }

    // 1. Consent verification
    const consent = await this.visitorRepo.getLatestMarketingConsent(job.store_id, job.visitor_id);
    if (!consent || !consent.opted_in) {
      return this.emailRepo.updateJobStatus(job.id, 'cancelled', { cancelReason: 'No marketing consent' });
    }

    // 2. Unsubscribe / suppression check
    const isSuppressed = await this.emailRepo.isSuppressed(job.store_id, visitor.email);
    if (isSuppressed) {
      return this.emailRepo.updateJobStatus(job.id, 'cancelled', { cancelReason: 'Email is suppressed' });
    }

    // 3. Purchase status check
    if (job.session_id) {
      const session = await this.chatRepo.getSessionById(job.store_id, job.session_id);
      if (session) {
        const purchaseAdapter = getPurchaseAdapter();
        const hasPurchased = await purchaseAdapter.hasPurchasedSince(job.store_id, visitor.email, session.started_at);
        if (hasPurchased) {
          return this.emailRepo.updateJobStatus(job.id, 'cancelled', { cancelReason: 'Purchase completed since session' });
        }
      }
    }

    // 4. Sender-domain verification check
    const verifiedDomain = await this.senderDomainRepo.getVerifiedDomain(job.store_id);
    if (!verifiedDomain) {
      return this.emailRepo.updateJobStatus(job.id, 'cancelled', { cancelReason: 'Sender domain unverified' });
    }

    // 5. Idempotency check: prevent duplicate sends
    const idempotencyKey = `${job.store_id}_job_${job.id}_stage_${job.stage}`;
    const alreadyDispatched = await this.emailRepo.isIdempotencyKeyDispatched(job.store_id, idempotencyKey);
    if (alreadyDispatched) {
      return this.emailRepo.updateJobStatus(job.id, 'cancelled', { cancelReason: 'Duplicate send prevented by idempotency key' });
    }

    const assistantSettings = await this.merchantRepo.getAssistantSettings(job.store_id);
    const brandName = store.brand_name || 'Our Store';
    const assistantName = assistantSettings?.assistant_name || 'Assistant';

    const subject = job.stage === 1 
      ? `We saved your chat with ${assistantName} at ${brandName}`
      : `Still thinking about it? Let ${assistantName} help.`;

    const body = `Hi there,\n\nYou recently chatted with ${assistantName}. We've saved your recommendations! Come back to ${brandName} to complete your order.`;

    const fromName = verifiedDomain.sender_name || brandName;
    const fromEmail = verifiedDomain.sender_email || `notifications@${verifiedDomain.domain_name}`;
    const fromAddress = `${fromName} <${fromEmail}>`;

    const emailProvider = getEmailProvider();
    const result = await emailProvider.sendEmail({
      to: visitor.email,
      subject,
      textBody: body,
      htmlBody: `<p>${body.replace(/\n/g, '<br/>')}</p>`,
      storeId: job.store_id,
      campaignType: job.campaign_type,
      from: fromAddress,
      idempotencyKey
    });

    const isSuccess = typeof result === 'boolean' ? result : result.success;
    const messageId = typeof result === 'object' ? result.messageId : undefined;
    const errorMsg = typeof result === 'object' ? result.error : undefined;

    if (isSuccess) {
      await this.emailRepo.updateJobStatus(job.id, 'sent', {
        providerMessageId: messageId,
        idempotencyKey
      });
    } else {
      await this.emailRepo.updateJobStatus(job.id, 'failed', {
        errorMsg: errorMsg || 'Email provider returned failure'
      });
    }
  }
}
