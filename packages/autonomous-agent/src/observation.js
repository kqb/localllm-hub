import { execFile } from 'child_process';
import { promisify } from 'util';
import { watch } from 'chokidar';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));

/**
 * Observation service for autonomous agent
 * Monitors environment for changes and generates structured events
 *
 * Sources:
 * - Email (via gog CLI)
 * - Calendar (via gog CLI)
 * - Git repos
 * - File system
 */

class ObservationService {
  constructor(memory = null) {
    this.memory = memory;
    this.sources = config.observation.sources;
    this.lastCheck = {};
    this.watchers = [];
  }

  /**
   * Check email for new messages
   */
  async checkEmail() {
    if (!this.sources.includes('email')) return [];

    try {
      // Use gog CLI to check for unread emails
      const { stdout } = await execFileAsync('gog', ['mail', 'list', '--unread', '--limit', '10']);

      if (!stdout || stdout.trim() === '') {
        return [];
      }

      const events = [];
      const lines = stdout.trim().split('\n');

      for (const line of lines) {
        // Parse gog output (simplified - adjust based on actual format)
        const match = line.match(/(\w+)\s+(.+?)\s+<(.+?)>\s+(.+)/);
        if (match) {
          const [, id, from, email, subject] = match;

          // Determine priority based on keywords
          const priority = this._calculateEmailPriority(subject);

          events.push({
            type: 'email',
            priority,
            data: {
              id,
              from: `${from} <${email}>`,
              subject,
              timestamp: new Date().toISOString()
            }
          });
        }
      }

      return events;
    } catch (error) {
      console.error('[Observation] Email check failed:', error.message);
      return [];
    }
  }

  /**
   * Check calendar for upcoming events
   */
  async checkCalendar() {
    if (!this.sources.includes('calendar')) return [];

    try {
      const lookahead = config.observation.calendar.lookahead_hours;
      const { stdout } = await execFileAsync('gog', ['cal', 'list', '--hours', String(lookahead)]);

      if (!stdout || stdout.trim() === '') {
        return [];
      }

      const events = [];
      const lines = stdout.trim().split('\n');

      for (const line of lines) {
        // Parse calendar events (simplified)
        const match = line.match(/(\d{2}:\d{2})\s+(.+)/);
        if (match) {
          const [, time, title] = match;

          events.push({
            type: 'calendar',
            priority: 'medium',
            data: {
              time,
              title,
              timestamp: new Date().toISOString()
            }
          });
        }
      }

      return events;
    } catch (error) {
      console.error('[Observation] Calendar check failed:', error.message);
      return [];
    }
  }

  /**
   * Check git repositories for changes
   */
  async checkGit() {
    if (!this.sources.includes('git')) return [];

    const events = [];

    for (const repoPath of config.observation.git.repos) {
      try {
        const expandedPath = repoPath.replace('~', process.env.HOME);
        const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
          cwd: expandedPath
        });

        if (stdout && stdout.trim() !== '') {
          const changes = stdout.trim().split('\n').length;

          events.push({
            type: 'git',
            priority: changes > 10 ? 'medium' : 'low',
            data: {
              repo: repoPath,
              changes,
              timestamp: new Date().toISOString()
            }
          });
        }
      } catch (error) {
        console.error(`[Observation] Git check failed for ${repoPath}:`, error.message);
      }
    }

    return events;
  }

  /**
   * Start file watchers
   */
  startFileWatchers() {
    if (!this.sources.includes('files')) return;

    const paths = config.observation.files.watch_paths.map(p => p.replace('~', process.env.HOME));

    const watcher = watch(paths, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100
      }
    });

    watcher.on('change', (path) => {
      const event = {
        type: 'file_change',
        priority: 'low',
        data: {
          path,
          timestamp: new Date().toISOString()
        }
      };

      // Log to memory if available
      if (this.memory) {
        this.memory.logObservation('file_watcher', 'change', 'low', event.data);
      }

      console.log('[Observation] File changed:', path);
    });

    watcher.on('add', (path) => {
      const event = {
        type: 'file_add',
        priority: 'low',
        data: {
          path,
          timestamp: new Date().toISOString()
        }
      };

      if (this.memory) {
        this.memory.logObservation('file_watcher', 'add', 'low', event.data);
      }

      console.log('[Observation] File added:', path);
    });

    this.watchers.push(watcher);
  }

  /**
   * Gather all observations
   */
  async observe() {
    const timestamp = new Date().toISOString();
    const events = [];

    // Gather events from all sources
    const [emailEvents, calendarEvents, gitEvents] = await Promise.all([
      this.checkEmail(),
      this.checkCalendar(),
      this.checkGit()
    ]);

    events.push(...emailEvents, ...calendarEvents, ...gitEvents);

    // Log observations to memory
    if (this.memory) {
      for (const event of events) {
        this.memory.logObservation(event.type, event.type, event.priority, event.data);
      }
    }

    return {
      timestamp,
      events,
      summary: {
        total: events.length,
        by_priority: {
          high: events.filter(e => e.priority === 'high').length,
          medium: events.filter(e => e.priority === 'medium').length,
          low: events.filter(e => e.priority === 'low').length
        }
      }
    };
  }

  /**
   * Calculate email priority based on keywords
   */
  _calculateEmailPriority(subject) {
    const lowerSubject = subject.toLowerCase();
    const keywords = config.observation.email.priority_keywords;

    for (const keyword of keywords) {
      if (lowerSubject.includes(keyword.toLowerCase())) {
        return 'high';
      }
    }

    return 'medium';
  }

  /**
   * Stop all watchers
   */
  async stop() {
    for (const watcher of this.watchers) {
      await watcher.close();
    }
    this.watchers = [];
  }
}

export default ObservationService;
