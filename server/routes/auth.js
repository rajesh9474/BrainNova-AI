const router = require('express').Router();
const { register, login, getProfile, googleAuth } = require('../controllers/authController');
const authenticate = require('../middleware/auth');

router.post('/register', register);
router.post('/login', login);
router.post('/google', googleAuth);
router.get('/profile', authenticate, getProfile);

module.exports = router;
