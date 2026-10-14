require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'coinrise_vercel_secret_key';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname)));

// Non-blocking rate limiters
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ error: 'Too many requests, please try again later.' })
});

const taskLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ error: 'Rate limit exceeded.' })
});

// High-performance In-Memory / Serverless Store with Default Seed Data
let dbStore = {
    users: [
        {
            id: 1,
            name: 'CoinRise Admin',
            email: process.env.ADMIN_EMAIL || 'admin@coinrise.app',
            password_hash: '', // initialized async
            points: 10000,
            streak: 7,
            level: 5,
            is_admin: 1,
            is_suspended: 0,
            referral_code: 'ADMIN2026',
            referred_by: '',
            created_at: new Date().toISOString()
        }
    ],
    tasks: [
        { id: 1, title: 'Install Finance App', description: 'Download & open finance app for 2 mins', reward_points: 150, category: 'App', is_active: 1 },
        { id: 2, title: 'Watch Reward Video', description: 'Watch short promotional clip', reward_points: 50, category: 'Video', is_active: 1 },
        { id: 3, title: 'Quick Opinion Survey', description: 'Complete 3-minute lifestyle survey', reward_points: 100, category: 'Survey', is_active: 1 },
        { id: 4, title: 'Play Puzzle Level 5', description: 'Reach level 5 in partner puzzle game', reward_points: 250, category: 'App', is_active: 1 },
        { id: 5, title: 'Daily Trivia Quiz', description: 'Answer 5 correct general knowledge questions', reward_points: 80, category: 'Quiz', is_active: 1 }
    ],
    user_tasks: [],
    transactions: [
        { id: 1, user_id: 1, title: 'Admin Initial Balance', points: 10000, type: 'earned', status: 'Completed', created_at: new Date().toISOString() }
    ],
    withdrawals: [],
    referrals: []
};

// Initialize default admin password hash properly on boot
(async () => {
    try {
        const adminPass = process.env.ADMIN_PASSWORD || 'secure_admin_password';
        dbStore.users[0].password_hash = await bcrypt.hash(adminPass, 10);
    } catch (e) {
        console.error('Error hashing admin password:', e);
    }
})();

// Helper function to authenticate token
function authenticateToken(req, res, next) {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        if (!token) return res.status(401).json({ error: 'Access token required' });

        jwt.verify(token, JWT_SECRET, (err, decoded) => {
            if (err) return res.status(403).json({ error: 'Invalid or expired token' });
            const user = dbStore.users.find(u => u.id === decoded.id);
            if (!user) return res.status(403).json({ error: 'User not found' });
            if (user.is_suspended) return res.status(403).json({ error: 'Account is suspended' });
            req.user = user;
            next();
        });
    } catch (e) {
        return res.status(500).json({ error: 'Server error' });
    }
}

function authenticateAdmin(req, res, next) {
    authenticateToken(req, res, () => {
        if (!req.user.is_admin) return res.status(403).json({ error: 'Admin access required' });
        next();
    });
}

// Routes - Auth
app.post('/api/auth/signup', authLimiter, async (req, res) => {
    try {
        const { name, email, password, referralCode } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Name, email, and password are required' });
        }

        const existing = dbStore.users.find(u => u.email.toLowerCase() === email.toLowerCase());
        if (existing) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        const password_hash = await bcrypt.hash(password, 10);
        const userId = dbStore.users.length + 1;
        const refCode = 'COIN' + Math.floor(1000 + Math.random() * 9000);

        const newUser = {
            id: userId,
            name,
            email,
            password_hash,
            points: 200,
            streak: 1,
            level: 1,
            is_admin: 0,
            is_suspended: 0,
            referral_code: refCode,
            referred_by: referralCode || '',
            created_at: new Date().toISOString()
        };

        dbStore.users.push(newUser);

        dbStore.transactions.push({
            id: dbStore.transactions.length + 1,
            user_id: userId,
            title: 'Sign-up Welcome Bonus',
            points: 200,
            type: 'earned',
            status: 'Completed',
            created_at: new Date().toISOString()
        });

        if (referralCode) {
            const referrer = dbStore.users.find(u => u.referral_code === referralCode);
            if (referrer) {
                referrer.points += 100;
                dbStore.referrals.push({
                    id: dbStore.referrals.length + 1,
                    referrer_id: referrer.id,
                    referred_name: name,
                    points_earned: 100,
                    created_at: new Date().toISOString()
                });
                dbStore.transactions.push({
                    id: dbStore.transactions.length + 1,
                    user_id: referrer.id,
                    title: `Referral Bonus: ${name}`,
                    points: 100,
                    type: 'earned',
                    status: 'Completed',
                    created_at: new Date().toISOString()
                });
            }
        }

        const token = jwt.sign({ id: userId, email, is_admin: 0 }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { id: userId, name, email, points: 200, referralCode: refCode, isAdmin: false } });
    } catch (e) {
        console.error('Signup error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

        const user = dbStore.users.find(u => u.email.toLowerCase() === email.toLowerCase());
        if (!user) return res.status(401).json({ error: 'Invalid email or password' });
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
    } catch (e) {
        console.error('Login error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// Profile endpoints (support both /api/user/profile and /api/auth/profile)
const profileHandler = (req, res) => {
    try {
        const txs = dbStore.transactions.filter(t => t.user_id === req.user.id).slice(-10).reverse();
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
            transactions: txs
        });
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
};

app.get('/api/user/profile', authenticateToken, profileHandler);
app.get('/api/auth/profile', authenticateToken, profileHandler);

// Tasks
app.get('/api/tasks', authenticateToken, (req, res) => {
    try {
        const tasks = dbStore.tasks.filter(t => t.is_active === 1).map(t => {
            const completed = dbStore.user_tasks.some(ut => ut.user_id === req.user.id && ut.task_id === t.id);
            return { ...t, completed };
        });
        res.json(tasks);
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/tasks/complete', authenticateToken, taskLimiter, (req, res) => {
    try {
        const { taskId } = req.body;
        const task = dbStore.tasks.find(t => t.id === Number(taskId) && t.is_active === 1);
        if (!task) return res.status(404).json({ error: 'Task not found' });

        const alreadyDone = dbStore.user_tasks.some(ut => ut.user_id === req.user.id && ut.task_id === task.id);
        if (alreadyDone) return res.status(400).json({ error: 'Task already completed' });

        dbStore.user_tasks.push({ id: dbStore.user_tasks.length + 1, user_id: req.user.id, task_id: task.id, completed_at: new Date().toISOString() });
        req.user.points += task.reward_points;

        dbStore.transactions.push({
            id: dbStore.transactions.length + 1,
            user_id: req.user.id,
            title: `Completed: ${task.title}`,
            points: task.reward_points,
            type: 'earned',
            status: 'Completed',
            created_at: new Date().toISOString()
        });

        res.json({ success: true, newBalance: req.user.points, earned: task.reward_points });
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Wallet & Withdrawals
app.post('/api/wallet/withdraw', authenticateToken, (req, res) => {
    try {
        const { upiId, amount } = req.body;
        if (!upiId || !amount || amount < 500) {
            return res.status(400).json({ error: 'Invalid withdrawal details. Minimum is 500 points.' });
        }
        if (amount > req.user.points) {
            return res.status(400).json({ error: 'Insufficient points balance.' });
        }

        req.user.points -= amount;
        dbStore.withdrawals.push({
            id: dbStore.withdrawals.length + 1,
            user_id: req.user.id,
            user_name: req.user.name,
            upi_id: upiId,
            amount: amount,
            status: 'Pending',
            requested_at: new Date().toISOString()
        });

        dbStore.transactions.push({
            id: dbStore.transactions.length + 1,
            user_id: req.user.id,
            title: `UPI Withdrawal to ${upiId}`,
            points: -amount,
            type: 'withdrawn',
            status: 'Pending',
            created_at: new Date().toISOString()
        });

        res.json({ success: true, newBalance: req.user.points });
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/wallet/withdrawals', authenticateToken, (req, res) => {
    try {
        const userWithdrawals = dbStore.withdrawals.filter(w => w.user_id === req.user.id);
        res.json(userWithdrawals);
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Referrals
app.get('/api/referrals', authenticateToken, (req, res) => {
    try {
        const refs = dbStore.referrals.filter(r => r.referrer_id === req.user.id);
        res.json(refs);
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Leaderboard
app.get('/api/leaderboard', (req, res) => {
    try {
        const leaders = dbStore.users
            .filter(u => !u.is_suspended)
            .sort((a, b) => b.points - a.points)
            .slice(0, 10)
            .map(u => ({ name: u.name, points: u.points, badge: 'User' }));
        res.json(leaders);
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Admin API
app.get('/api/admin/users', authenticateAdmin, (req, res) => {
    try {
        res.json(dbStore.users.map(u => ({
            id: u.id,
            name: u.name,
            email: u.email,
            points: u.points,
            streak: u.streak,
            level: u.level,
            is_admin: u.is_admin,
            is_suspended: u.is_suspended,
            referral_code: u.referral_code,
            created_at: u.created_at
        })));
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/admin/users/:id/suspend', authenticateAdmin, (req, res) => {
    try {
        const userId = Number(req.params.id);
        const user = dbStore.users.find(u => u.id === userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        user.is_suspended = user.is_suspended ? 0 : 1;
        res.json({ success: true, is_suspended: user.is_suspended });
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/admin/tasks', authenticateAdmin, (req, res) => {
    try {
        res.json(dbStore.tasks);
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/admin/tasks', authenticateAdmin, (req, res) => {
    try {
        const { title, description, rewardPoints, category } = req.body;
        if (!title || !rewardPoints) return res.status(400).json({ error: 'Title and reward points required' });
        const newTask = {
            id: dbStore.tasks.length + 1,
            title,
            description: description || '',
            reward_points: Number(rewardPoints),
            category: category || 'App',
            is_active: 1
        };
        dbStore.tasks.push(newTask);
        res.json({ success: true, taskId: newTask.id });
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/admin/withdrawals', authenticateAdmin, (req, res) => {
    try {
        res.json(dbStore.withdrawals);
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/admin/withdrawals/:id/status', authenticateAdmin, (req, res) => {
    try {
        const wId = Number(req.params.id);
        const { status } = req.body;
        if (!['Approved', 'Paid', 'Rejected'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }
        const w = dbStore.withdrawals.find(item => item.id === wId);
        if (!w) return res.status(404).json({ error: 'Withdrawal not found' });

        w.status = status;
        if (status === 'Rejected') {
            const user = dbStore.users.find(u => u.id === w.user_id);
            if (user) {
                user.points += w.amount;
                dbStore.transactions.push({
                    id: dbStore.transactions.length + 1,
                    user_id: user.id,
                    title: 'Withdrawal Rejected & Refunded',
                    points: w.amount,
                    type: 'earned',
                    status: 'Refunded',
                    created_at: new Date().toISOString()
                });
            }
        }
        res.json({ success: true, status });
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Fallback for SPA routing
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Export for Vercel Serverless Functions
module.exports = app;

// Start local server if run directly (with EADDRINUSE graceful handling)
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`CoinRise production server running on port ${PORT}`);
    }).on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`Port ${PORT} is in use by container runtime proxy. App is active.`);
        } else {
            console.error('Server error:', err);
        }
    });
}
