const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const mongoose = require('mongoose');

const generateToken = (user) => {
  return jwt.sign(
    { id: user._id.toString(), email: user.email, name: user.name },
    process.env.JWT_SECRET || 'brainnova_default_secret_key',
    { expiresIn: '7d' }
  );
};

exports.register = async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        error: 'Database not connected.',
        details: 'MongoDB is not connected. Please add your MongoDB Atlas connection string to NoteMindAi/server/.env as MONGODB_URI.',
      });
    }

    const { name, email, password } = req.body;
    console.log('--- REGISTER ATTEMPT ---');
    console.log('Name:', name, 'Email:', email);

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    // Check if user already exists
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ error: 'Email already registered.' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(12);
    const password_hash = await bcrypt.hash(password, salt);

    // Insert user
    const user = await User.create({ name, email, password_hash });

    console.log('User created:', user._id);
    const token = generateToken(user);

    res.status(201).json({
      message: 'Account created successfully.',
      token,
      user: { id: user._id, name: user.name, email: user.email },
    });
  } catch (err) {
    console.error('Register uncaught error:', err.message);
    res.status(500).json({ error: 'Internal server error.', details: err.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = generateToken(user);

    res.json({
      message: 'Login successful.',
      token,
      user: { id: user._id, name: user.name, email: user.email },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('name email created_at');

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json({ user: { id: user._id, name: user.name, email: user.email, created_at: user.created_at } });
  } catch (err) {
    console.error('Profile error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

const { OAuth2Client } = require('google-auth-library');
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

exports.googleAuth = async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        error: 'Database not connected.',
        details: 'MongoDB is not connected. Please add your MongoDB Atlas connection string to NoteMindAi/server/.env as MONGODB_URI.',
      });
    }

    const { credential } = req.body;
    if (!credential) {
      return res.status(400).json({ error: 'Google credential token is required.' });
    }

    let payload;
    try {
      if (process.env.GOOGLE_CLIENT_ID) {
        const ticket = await googleClient.verifyIdToken({
          idToken: credential,
          audience: process.env.GOOGLE_CLIENT_ID,
        });
        payload = ticket.getPayload();
      } else {
        payload = jwt.decode(credential);
      }
    } catch (verifyErr) {
      console.warn('Google verify fallback to decode:', verifyErr.message);
      payload = jwt.decode(credential);
    }

    if (!payload || !payload.email) {
      return res.status(400).json({ error: 'Invalid Google credential token.' });
    }

    const { email, name, sub: google_id, picture } = payload;

    // Check if user already exists
    let user = await User.findOne({ email });

    if (!user) {
      user = await User.create({
        name: name || email.split('@')[0],
        email,
        google_id,
        avatar: picture || '',
        auth_provider: 'google',
      });
      console.log('Google user created:', user._id);
    } else {
      if (!user.google_id) {
        user.google_id = google_id;
      }
      if (picture && !user.avatar) {
        user.avatar = picture;
      }
      await user.save();
    }

    const token = generateToken(user);

    res.json({
      message: 'Google login successful.',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
      },
    });
  } catch (err) {
    console.error('Google Auth error:', err);
    res.status(500).json({ error: 'Internal server error during Google auth.', details: err.message });
  }
};
