require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'coinrise_default_secret_key';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Rate limiters for security & anti-fraud
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // limit each IP to 20 login/signup requests per window
    message: { error: 'Too many requests, please try again later.' }
});

const taskLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30, // limit task completions
    message: { error: 'Rate limit exceeded for task completion.' }
});

// Database Setup
const dbFile = process.env.DATABASE_FILE || 'database.sqlite';
const db = new sqlite3.Database(dbFile, (err) => {
    if (err) {
        console.error('Database opening error: ' + err.message);
    } else {
        console.log('Connected to SQLite database.');
        initDatabase();
    }
});

function initDatabase() {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            points INTEGER DEFAULT 200,
            streak INTEGER DEFAULT 1,
            level INTEGER DEFAULT 1,
            is_admin INTEGER DEFAULT 0,
            is_suspended INTEGER DEFAULT 0,
            referral_code TEXT UNIQUE,
            referred_by TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            reward_points INTEGER NOT NULL,
            category TEXT NOT NULL,
            is_active INTEGER DEFAULT 1
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS user_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            task_id INTEGER,
            completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, task_id)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            title TEXT NOT NULL,
            points INTEGER NOT NULL,
            type TEXT NOT NULL,
            status TEXT DEFAULT 'Completed',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS withdrawals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            user_name TEXT,
            upi_id TEXT NOT NULL,
            amount INTEGER NOT NULL,
            status TEXT DEFAULT 'Pending',
            requested_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS referrals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            referrer_id INTEGER,
            referred_name TEXT,
            points_earned INTEGER DEFAULT 100,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Seed Admin and default tasks if empty
        db.get(`SELECT COUNT(*) as count FROM users WHERE is_admin = 1`, async (err, row) => {
            if (row && row.count === 0) {
                const adminEmail = process.env.ADMIN_EMAIL || 'admin@coinrise.app';
                const adminPass = process.env.ADMIN_PASSWORD || 'secure_admin_password';
                const hash = await bcrypt.hash(adminPass, 10);
                db.run(`INSERT INTO users (name, email, password_hash, points, is_admin, referral_code) VALUES (?, ?, ?, ?, ?, ?)`,
                    ['CoinRise Admin', adminEmail, hash, 10000, 1, 'ADMIN2026']);
                console.log(`Default admin created: ${adminEmail}`);
            }
        });

        db.get(`SELECT COUNT(*) as count FROM tasks`, (err, row) => {
            if (row && row.count === 0) {
                const defaultTasks = [
                    ['Install Finance App', 'Download & open finance app for 2 mins', 150, 'App'],
                    ['Watch Reward Video', 'Watch short promotional clip', 50, 'Video'],
                    ['Quick Opinion Survey', 'Complete 3-minute lifestyle survey', 100, 'Survey'],
                    ['Play Puzzle Level 5', 'Reach level 5 in partner puzzle game', 250, 'App'],
                    ['Daily Trivia Quiz', 'Answer 5 correct general knowledge questions', 80, 'Quiz']
                ];
                const stmt = db.prepare(`INSERT INTO tasks (title, description, reward_points, category) VALUES (?, ?, ?, ?)`);
                defaultTasks.forEach(t => stmt.run(t));
                stmt.finalize();
                console.log('Default tasks seeded.');
            }
        });
    });
}

// Authentication Middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Access token required' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid or expired token' });
        db.get(`SELECT * FROM users WHERE id = ?`, [user.id], (err, dbUser) => {
            if (err || !dbUser) return res.status(403).json({ error: 'User not found' });
            if (dbUser.is_suspended) return res.status(403).json({ error: 'Account is suspended' });
            req.user = dbUser;
            next();
        });
    });
}

function authenticateAdmin(req, res, next) {
    authenticateToken(req, res, () => {
        if (!req.user.is_admin) return res.status(403).json({ error: 'Admin access required' });
        next();
    });
}

// API Routes - Auth
app.post('/api/auth/signup', authLimiter, async (req, res) => {
    const { name, email, password, referralCode } = req.body;
    if (!name || !email || !password) {
        return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    try {
        const hash = await bcrypt.hash(password, 10);
        const refCode = 'COIN' + Math.floor(1000 + Math.random() * 9000);

        db.run(`INSERT INTO users (name, email, password_hash, points, referral_code, referred_by) VALUES (?, ?, ?, 200, ?, ?)`,
            [name, email, hash, refCode, referralCode || ''], async function(err) {
                if (err) {
                    return res.status(400).json({ error: 'Email already registered or invalid data' });
                }
                const userId = this.lastID;

                // Log signup bonus transaction
                db.run(`INSERT INTO transactions (user_id, title, points, type) VALUES (?, ?, 200, 'earned')`,
                    [userId, 'Sign-up Welcome Bonus']);

                // Handle referral bonus if valid
                if (referralCode) {
                    db.get(`SELECT id FROM users WHERE referral_code = ?`, [referralCode], (err, referrer) => {
                        if (referrer) {
                            db.run(`UPDATE users SET points = points + 100 WHERE id = ?`, [referrer.id]);
                            db.run(`INSERT INTO referrals (referrer_id, referred_name) VALUES (?, ?)`, [referrer.id, name]);
                            db.run(`INSERT INTO transactions (user_id, title, points, type) VALUES (?, ?, 100, 'earned')`,
                                [referrer.id, `Referral Bonus: ${name}`]);
                        }
                    });
                }

                const token = jwt.sign({ id: userId, email, is_admin: 0 }, JWT_SECRET, { expiresIn: '7d' });
                res.json({ token, user: { id: userId, name, email, points: 200, referralCode: refCode, isAdmin: false } });
            });
    } catch (e) {
        res.status(500).json({ error: 'Server error during signup' });
    }
});

app.post('/api/auth/login', authLimiter, (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
        if (err || !user) return res.status(401).json({ error: 'Invalid email or password' });
        if (user.is_suspended) return res.status(403).json({ error: 'Account is suspended' });

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

        const token = jwt.sign({ id: user.id, email: user.email, is_admin: user.is_admin }, JWT_SECRET, { expiresIn: '7d' });
        res.json({
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                points: user.points,
                streak: user.streak,
                level: user.level,
                referralCode: user.referral_code,
                isAdmin: user.is_admin === 1
            }
        });
    });
});

// API Routes - User Profile & Data
app.get('/api/user/profile', authenticateToken, (req, res) => {
    db.all(`SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`, [req.user.id], (err, txs) => {
        res.json({
            user: {
                id: req.user.id,
                name: req.user.name,
                email: req.user.email,
                points: req.user.points,
                streak: req.user.streak,
                level: req.user.level,
                referralCode: req.user.referral_code,
                isAdmin: req.user.is_admin === 1
            },
            transactions: txs || []
        });
    });
});

// API Routes - Tasks
app.get('/api/tasks', authenticateToken, (req, res) => {
    db.all(`SELECT t.*, 
            (SELECT COUNT(*) FROM user_tasks ut WHERE ut.task_id = t.id AND ut.user_id = ?) as completed 
            FROM tasks t WHERE t.is_active = 1`, [req.user.id], (err, tasks) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(tasks.map(t => ({ ...t, completed: t.completed > 0 })));
    });
});

app.post('/api/tasks/complete', authenticateToken, taskLimiter, (req, res) => {
    const { taskId } = req.body;
    if (!taskId) return res.status(400).json({ error: 'Task ID required' });

    db.get(`SELECT * FROM tasks WHERE id = ? AND is_active = 1`, [taskId], (err, task) => {
        if (err || !task) return res.status(404).json({ error: 'Task not found' });

        db.get(`SELECT * FROM user_tasks WHERE user_id = ? AND task_id = ?`, [req.user.id, taskId], (err, existing) => {
            if (existing) return res.status(400).json({ error: 'Task already completed' });

            db.serialize(() => {
                db.run(`INSERT INTO user_tasks (user_id, task_id) VALUES (?, ?)`, [req.user.id, taskId]);
                db.run(`UPDATE users SET points = points + ? WHERE id = ?`, [task.reward_points, req.user.id]);
                db.run(`INSERT INTO transactions (user_id, title, points, type) VALUES (?, ?, ?, 'earned')`,
                    [req.user.id, `Completed: ${task.title}`, task.reward_points]);

                db.get(`SELECT points FROM users WHERE id = ?`, [req.user.id], (err, row) => {
                    res.json({ success: true, newBalance: row.points, earned: task.reward_points });
                });
            });
        });
    });
});

// API Routes - Wallet & Withdrawal
app.post('/api/wallet/withdraw', authenticateToken, (req, res) => {
    const { upiId, amount } = req.body;
    if (!upiId || !amount || amount < 500) {
        return res.status(400).json({ error: 'Invalid withdrawal details. Minimum is 500 points.' });
    }

    if (amount > req.user.points) {
        return res.status(400).json({ error: 'Insufficient points balance.' });
    }

    db.serialize(() => {
        db.run(`UPDATE users SET points = points - ? WHERE id = ?`, [amount, req.user.id]);
        db.run(`INSERT INTO withdrawals (user_id, user_name, upi_id, amount, status) VALUES (?, ?, ?, ?, 'Pending')`,
            [req.user.id, req.user.name, upiId, amount]);
        db.run(`INSERT INTO transactions (user_id, title, points, type, status) VALUES (?, ?, ?, 'withdrawn', 'Pending')`,
            [req.user.id, `UPI Withdrawal to ${upiId}`, -amount]);

        db.get(`SELECT points FROM users WHERE id = ?`, [req.user.id], (err, row) => {
            res.json({ success: true, newBalance: row.points });
        });
    });
});

app.get('/api/wallet/withdrawals', authenticateToken, (req, res) => {
    db.all(`SELECT * FROM withdrawals WHERE user_id = ? ORDER BY requested_at DESC`, [req.user.id], (err, rows) => {
        res.json(rows || []);
    });
});

// API Routes - Referrals
app.get('/api/referrals', authenticateToken, (req, res) => {
    db.all(`SELECT * FROM referrals WHERE referrer_id = ? ORDER BY created_at DESC`, [req.user.id], (err, rows) => {
        res.json(rows || []);
    });
});

// API Routes - Leaderboard
app.get('/api/leaderboard', (req, res) => {
    db.all(`SELECT name, points, 'User' as badge FROM users WHERE is_suspended = 0 ORDER BY points DESC LIMIT 10`, (err, rows) => {
        res.json(rows || []);
    });
});

// API Routes - Admin
app.get('/api/admin/users', authenticateAdmin, (req, res) => {
    db.all(`SELECT id, name, email, points, streak, level, is_admin, is_suspended, referral_code, created_at FROM users`, (err, rows) => {
        res.json(rows || []);
    });
});

app.post('/api/admin/users/:id/suspend', authenticateAdmin, (req, res) => {
    const userId = req.params.id;
    db.get(`SELECT is_suspended FROM users WHERE id = ?`, [userId], (err, user) => {
        if (!user) return res.status(404).json({ error: 'User not found' });
        const newStatus = user.is_suspended ? 0 : 1;
        db.run(`UPDATE users SET is_suspended = ? WHERE id = ?`, [newStatus, userId], () => {
            res.json({ success: true, is_suspended: newStatus });
        });
    });
});

app.get('/api/admin/tasks', authenticateAdmin, (req, res) => {
    db.all(`SELECT * FROM tasks`, (err, rows) => res.json(rows || []));
});

app.post('/api/admin/tasks', authenticateAdmin, (req, res) => {
    const { title, description, rewardPoints, category } = req.body;
    if (!title || !rewardPoints) return res.status(400).json({ error: 'Title and reward points required' });
    db.run(`INSERT INTO tasks (title, description, reward_points, category) VALUES (?, ?, ?, ?)`,
        [title, description || '', rewardPoints, category || 'App'], function() {
            res.json({ success: true, taskId: this.lastID });
        });
});

app.get('/api/admin/withdrawals', authenticateAdmin, (req, res) => {
    db.all(`SELECT * FROM withdrawals ORDER BY requested_at DESC`, (err, rows) => res.json(rows || []));
});

app.post('/api/admin/withdrawals/:id/status', authenticateAdmin, (req, res) => {
    const withdrawalId = req.params.id;
    const { status } = req.body; // 'Approved', 'Paid', 'Rejected'
    if (!['Approved', 'Paid', 'Rejected'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }

    db.get(`SELECT * FROM withdrawals WHERE id = ?`, [withdrawalId], (err, w) => {
        if (!w) return res.status(404).json({ error: 'Withdrawal not found' });

        db.serialize(() => {
            db.run(`UPDATE withdrawals SET status = ? WHERE id = ?`, [status, withdrawalId]);
            if (status === 'Rejected') {
                // Refund points if rejected
                db.run(`UPDATE users SET points = points + ? WHERE id = ?`, [w.amount, w.user_id]);
                db.run(`INSERT INTO transactions (user_id, title, points, type, status) VALUES (?, ?, ?, 'earned', 'Refunded')`,
                    [w.user_id, `Withdrawal Rejected & Refunded`, w.amount]);
            }
            res.json({ success: true, status });
        });
    });
});

// Serve frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`CoinRise production web server running on port ${PORT}`);
});
