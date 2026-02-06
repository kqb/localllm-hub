/**
 * Event Bus - Redis/BullMQ Integration
 * 
 * Decoupled event publishing for agent state changes.
 * Clawdbot extension subscribes to receive real-time updates.
 */

const { Queue } = require('bullmq');
const Redis = require('ioredis');

class EventBus {
  constructor(redisUrl = 'redis://localhost:6379') {
    // BullMQ requires maxRetriesPerRequest: null
    const redisOpts = { maxRetriesPerRequest: null };
    this.redis = new Redis(redisUrl, redisOpts);
    
    // Create queues for different event types
    this.queues = {
      events: new Queue('agent-events', { 
        connection: new Redis(redisUrl, redisOpts)
      }),
      commands: new Queue('agent-commands', { 
        connection: new Redis(redisUrl, redisOpts)
      }),
    };
    
    console.log('[EventBus] Connected to Redis:', redisUrl);
  }
  
  /**
   * Publish agent event (state change, progress, stuck, error, etc.)
   */
  async publishEvent(event, data) {
    const payload = {
      event,
      timestamp: Date.now(),
      ...data,
    };
    
    try {
      await this.queues.events.add(event, payload, {
        removeOnComplete: 100, // Keep last 100 events
        removeOnFail: 50,
      });
      
      // Also publish to Redis pub/sub for instant WebSocket broadcast
      await this.redis.publish('agent-events', JSON.stringify(payload));
      
      console.log(`[EventBus] Published: ${event} for ${data.session || 'unknown'}`);
    } catch (err) {
      console.error('[EventBus] Error publishing event:', err);
    }
  }
  
  /**
   * Enqueue command for agent
   */
  async enqueueCommand(session, command, source = 'user') {
    const payload = {
      session,
      command,
      source,
      status: 'pending',
      timestamp: Date.now(),
    };
    
    try {
      const job = await this.queues.commands.add('send-command', payload, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 100,
      });
      
      console.log(`[EventBus] Command queued: ${command.slice(0, 50)} for ${session}`);
      return job.id;
    } catch (err) {
      console.error('[EventBus] Error queueing command:', err);
      throw err;
    }
  }
  
  /**
   * Subscribe to events (for WebSocket server)
   */
  async subscribe(callback) {
    const subscriber = this.redis.duplicate();
    subscriber.subscribe('agent-events');
    
    subscriber.on('message', (channel, message) => {
      if (channel === 'agent-events') {
        try {
          const event = JSON.parse(message);
          callback(event);
        } catch (err) {
          console.error('[EventBus] Error parsing event:', err);
        }
      }
    });
    
    console.log('[EventBus] Subscribed to agent-events channel');
    return subscriber;
  }
  
  /**
   * Get recent events from queue
   */
  async getRecentEvents(limit = 50) {
    try {
      const completed = await this.queues.events.getCompleted(0, limit - 1);
      return completed.map(job => job.data).reverse();
    } catch (err) {
      console.error('[EventBus] Error fetching recent events:', err);
      return [];
    }
  }
  
  /**
   * Get pending commands
   */
  async getPendingCommands(session = null) {
    try {
      const waiting = await this.queues.commands.getWaiting(0, -1);
      const active = await this.queues.commands.getActive(0, -1);
      
      let commands = [...waiting, ...active].map(job => job.data);
      
      if (session) {
        commands = commands.filter(cmd => cmd.session === session);
      }
      
      return commands;
    } catch (err) {
      console.error('[EventBus] Error fetching pending commands:', err);
      return [];
    }
  }
  
  /**
   * Get command by ID
   */
  async getCommand(jobId) {
    try {
      const job = await this.queues.commands.getJob(jobId);
      return job ? job.data : null;
    } catch (err) {
      console.error('[EventBus] Error fetching command:', err);
      return null;
    }
  }
  
  /**
   * Close connections
   */
  async close() {
    await this.redis.quit();
    await this.queues.events.close();
    await this.queues.commands.close();
    console.log('[EventBus] Connections closed');
  }
}

module.exports = EventBus;
