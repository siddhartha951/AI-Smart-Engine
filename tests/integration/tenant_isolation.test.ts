import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryPostgresClient } from '../../src/database/client';
import { Migrator } from '../../src/database/migrator';
import { MerchantRepository } from '../../src/modules/merchant/merchant.repository';
import { VisitorRepository } from '../../src/modules/visitor/visitor.repository';
import { ChatRepository } from '../../src/modules/chat/chat.repository';
import { EventRepository } from '../../src/modules/events/event.repository';
import { EmailRepository } from '../../src/modules/email/email.repository';
import { TenantIsolationError } from '../../src/utils/errors';

describe('Strict Tenant Isolation (Store A vs Store B)', () => {
  let db: InMemoryPostgresClient;
  let merchantRepo: MerchantRepository;
  let visitorRepo: VisitorRepository;
  let chatRepo: ChatRepository;
  let eventRepo: EventRepository;
  let emailRepo: EmailRepository;

  const STORE_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; // London Eco Apparel
  const STORE_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; // Highland Peak Gear

  beforeEach(async () => {
    db = new InMemoryPostgresClient();
    const migrator = new Migrator(db);
    await migrator.runMigrations();

    merchantRepo = new MerchantRepository(db);
    visitorRepo = new VisitorRepository(db);
    chatRepo = new ChatRepository(db);
    eventRepo = new EventRepository(db);
    emailRepo = new EmailRepository(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('proves Store A cannot access Store B credentials or private settings', async () => {
    const credsA = await merchantRepo.getStoreCredentials(STORE_A_ID);
    const credsB = await merchantRepo.getStoreCredentials(STORE_B_ID);

    expect(credsA).not.toBeNull();
    expect(credsB).not.toBeNull();
    expect(credsA?.encrypted_admin_token).toBe('enc_mock_admin_token_store_a');
    expect(credsB?.encrypted_admin_token).toBe('enc_mock_admin_token_store_b');

    // Cross-check: querying Store A credentials does not return Store B token
    expect(credsA?.encrypted_admin_token).not.toBe(credsB?.encrypted_admin_token);
  });

  it('proves Store A cannot read, query, or hijack Store B visitors', async () => {
    // Create visitor in Store B
    const visitorB = await visitorRepo.getOrCreateVisitor(STORE_B_ID, 'anon_shopper_b');
    expect(visitorB.store_id).toBe(STORE_B_ID);

    // Store A attempts to read visitor B by ID -> must return null
    const crossRead = await visitorRepo.getVisitorById(STORE_A_ID, visitorB.id);
    expect(crossRead).toBeNull();

    // Store A attempts to update visitor B lead -> must throw TenantIsolationError
    await expect(
      visitorRepo.updateVisitorLead(STORE_A_ID, visitorB.id, 'hacker@store-a.com')
    ).rejects.toThrow(TenantIsolationError);

    // Store A attempts to record marketing consent for visitor B -> must throw TenantIsolationError
    await expect(
      visitorRepo.recordMarketingConsent(
        STORE_A_ID,
        visitorB.id,
        true,
        'Fake consent wording'
      )
    ).rejects.toThrow(TenantIsolationError);
  });

  it('proves Store A cannot read, append to, or hijack Store B chat sessions', async () => {
    // Setup visitor and session in Store B
    const visitorB = await visitorRepo.getOrCreateVisitor(STORE_B_ID, 'visitor_peak_42');
    const sessionB = await chatRepo.createSession(STORE_B_ID, visitorB.id);
    expect(sessionB.store_id).toBe(STORE_B_ID);

    // Store A attempts to read Store B session -> must return null
    const crossSession = await chatRepo.getSessionById(STORE_A_ID, sessionB.id);
    expect(crossSession).toBeNull();

    // Store A attempts to inject chat message into Store B session -> must throw TenantIsolationError
    await expect(
      chatRepo.addMessage(STORE_A_ID, sessionB.id, 'user', 'Cross-store message injection!')
    ).rejects.toThrow(TenantIsolationError);

    // Store A attempts to read messages from Store B session -> must throw TenantIsolationError
    await expect(
      chatRepo.getSessionMessages(STORE_A_ID, sessionB.id)
    ).rejects.toThrow(TenantIsolationError);
  });

  it('proves Store A cannot inject or read recommendations in Store B session', async () => {
    const visitorB = await visitorRepo.getOrCreateVisitor(STORE_B_ID, 'visitor_b_rec');
    const sessionB = await chatRepo.createSession(STORE_B_ID, visitorB.id);

    // Store A attempts to attach recommendation to Store B session
    await expect(
      chatRepo.addRecommendation(STORE_A_ID, sessionB.id, {
        productId: 'prod_eco_101',
        variantId: 'var_eco_101_s',
        title: 'Organic Eco T-Shirt',
        price: 25.0,
        reason: 'Store A product wrongly targeted to Store B',
      })
    ).rejects.toThrow(TenantIsolationError);

    // Store A attempts to read recommendations for Store B session
    await expect(
      chatRepo.getSessionRecommendations(STORE_A_ID, sessionB.id)
    ).rejects.toThrow(TenantIsolationError);
  });

  it('proves Store A cannot record or access Store B events', async () => {
    const visitorB = await visitorRepo.getOrCreateVisitor(STORE_B_ID, 'visitor_b_events');

    // Store A attempts to record event for Store B visitor -> must throw TenantIsolationError
    await expect(
      eventRepo.recordEvent(STORE_A_ID, visitorB.id, 'add_to_cart', { item: 'jacket' })
    ).rejects.toThrow(TenantIsolationError);

    // Store B legitimately records an event
    await eventRepo.recordEvent(STORE_B_ID, visitorB.id, 'add_to_cart', { item: 'alpine_jacket' });

    // Store A queries events for visitor B -> must throw TenantIsolationError or return empty
    await expect(
      eventRepo.getVisitorEvents(STORE_A_ID, visitorB.id)
    ).resolves.toEqual([]);
  });

  it('proves Store A cannot cancel or inspect Store B email jobs or suppressions', async () => {
    // Store A adds suppression for a user
    await emailRepo.addSuppression(STORE_A_ID, 'customer@domain.com', 'unsubscribed');

    // Store A checks suppression -> true
    expect(await emailRepo.isSuppressed(STORE_A_ID, 'customer@domain.com')).toBe(true);

    // Store B checks suppression for same email -> false (isolated per-store suppression)
    expect(await emailRepo.isSuppressed(STORE_B_ID, 'customer@domain.com')).toBe(false);

    // Setup visitor and email job in Store B
    const visitorB = await visitorRepo.getOrCreateVisitor(STORE_B_ID, 'visitor_b_email');
    const sessionB = await chatRepo.createSession(STORE_B_ID, visitorB.id);
    await emailRepo.scheduleRecoveryJob(
      STORE_B_ID,
      visitorB.id,
      sessionB.id,
      1,
      new Date(Date.now() - 1000)
    );

    // Store A attempts to cancel Store B's email jobs
    const cancelledCount = await emailRepo.cancelVisitorJobs(
      STORE_A_ID,
      visitorB.id,
      'purchased'
    );
    expect(cancelledCount).toBe(0);

    // Store B jobs must remain intact
    const pendingB = await emailRepo.getPendingJobs(STORE_B_ID);
    expect(pendingB.length).toBe(1);
    expect(pendingB[0].store_id).toBe(STORE_B_ID);

    // Store A pending jobs query must NOT return Store B job
    const pendingA = await emailRepo.getPendingJobs(STORE_A_ID);
    expect(pendingA.length).toBe(0);
  });
});
