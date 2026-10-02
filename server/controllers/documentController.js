const path = require('path');
const fs = require('fs');
const Document = require('../models/Document');
const Summary = require('../models/Summary');
const Quiz = require('../models/Quiz');
const Flashcard = require('../models/Flashcard');
const { extractTextFromPDF } = require('../services/pdfService');
const {
  generateSummary,
  generateQuiz,
  generateFlashcards,
  askQuestion,
} = require('../services/geminiService');

/**
 * Upload a document, extract text, and generate AI study content.
 */
exports.uploadDocument = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    const userId = req.user.id;
    const file = req.file;

    console.log('--- UPLOAD START ---');
    console.log('User ID:', userId);
    console.log('File:', file.originalname, 'Size:', file.size, 'Type:', file.mimetype);

    // 1. Save file to local uploads directory
    const uploadDir = path.join(__dirname, '..', 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const fileExt = path.extname(file.originalname);
    const safeBaseName = path.basename(file.originalname, fileExt).replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeFileName = `${userId}_${Date.now()}_${safeBaseName}${fileExt}`;
    const filePath = path.join(uploadDir, safeFileName);

    await fs.promises.writeFile(filePath, file.buffer);
    const fileUrl = `/uploads/${safeFileName}`;
    console.log('Step 1: Saved file locally at:', filePath);

    // 2. Extract text from PDF buffer
    let extractedText = '';
    try {
      extractedText = await extractTextFromPDF(file.buffer);
      console.log('Step 2: Extracted', extractedText.length, 'characters');
    } catch (e) {
      console.error('Text extraction failed:', e.message);
    }

    // 3. Create Document record in MongoDB
    const doc = await Document.create({
      user_id: userId,
      file_name: file.originalname,
      file_path: filePath,
      file_url: fileUrl,
      extracted_text: extractedText || '',
    });
    console.log('Step 3: Saved document record in MongoDB - ID:', doc._id);

    // 4. Try AI processing — if it fails, document is still saved
    let summaryText = '';
    let quizQuestions = [];
    let flashcardItems = [];
    let aiProcessed = false;
    let aiError = null;

    if (extractedText && extractedText.trim().length >= 50) {
      try {
        console.log('Step 4a: Generating summary...');
        summaryText = await generateSummary(extractedText);
        console.log('  Summary done. Waiting 5s...');
        await new Promise((r) => setTimeout(r, 5000));

        console.log('Step 4b: Generating quiz...');
        quizQuestions = await generateQuiz(extractedText);
        console.log('  Quiz done. Waiting 5s...');
        await new Promise((r) => setTimeout(r, 5000));

        console.log('Step 4c: Generating flashcards...');
        flashcardItems = await generateFlashcards(extractedText);
        console.log('Step 4: All AI study content generated');

        // Store results in MongoDB
        await Summary.create({
          document_id: doc._id,
          summary_text: summaryText,
        });

        if (quizQuestions.length > 0) {
          await Quiz.insertMany(
            quizQuestions.map((q) => ({
              document_id: doc._id,
              question: q.question,
              options: q.options,
              correct_answer: q.correct_answer,
            }))
          );
        }

        if (flashcardItems.length > 0) {
          await Flashcard.insertMany(
            flashcardItems.map((f) => ({
              document_id: doc._id,
              question: f.question,
              answer: f.answer,
            }))
          );
        }

        aiProcessed = true;
      } catch (err) {
        aiError = err.message;
        console.error('AI processing failed (document still saved):', err.message);
      }
    } else {
      aiError = 'Extracted text is too short for AI processing.';
      console.log('Step 4 SKIPPED - text too short');
    }

    console.log('--- UPLOAD COMPLETE ---');

    res.status(201).json({
      message: aiProcessed
        ? 'Document uploaded and processed successfully.'
        : 'Document uploaded. AI processing failed — you can reprocess later.',
      document: doc,
      aiProcessed,
      aiError,
      summary: summaryText,
      quiz: quizQuestions,
      flashcards: flashcardItems,
    });
  } catch (err) {
    console.error('Upload error (uncaught):', err.message);
    res.status(500).json({ error: 'Internal server error during upload.', details: err.message });
  }
};

/**
 * Get all documents for the logged-in user.
 */
exports.getUserDocuments = async (req, res) => {
  try {
    const documents = await Document.find({ user_id: req.user.id }).sort({ uploaded_at: -1 });
    res.json({ documents });
  } catch (err) {
    console.error('Get documents error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

/**
 * Get a single document with its generated study content.
 */
exports.getDocumentDetail = async (req, res) => {
  try {
    const { id } = req.params;

    const doc = await Document.findOne({ _id: id, user_id: req.user.id });
    if (!doc) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    // Fetch related study content in parallel
    const [summaryRes, quizRes, flashcardRes] = await Promise.all([
      Summary.findOne({ document_id: id }),
      Quiz.find({ document_id: id }),
      Flashcard.find({ document_id: id }),
    ]);

    res.json({
      document: doc,
      summary: summaryRes?.summary_text || null,
      quiz: quizRes || [],
      flashcards: flashcardRes || [],
    });
  } catch (err) {
    console.error('Document detail error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

/**
 * Ask AI a question about a specific document.
 */
exports.askDocumentQuestion = async (req, res) => {
  try {
    const { id } = req.params;
    const { question } = req.body;

    if (!question) {
      return res.status(400).json({ error: 'Question is required.' });
    }

    const doc = await Document.findOne({ _id: id, user_id: req.user.id });
    if (!doc) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    let text = doc.extracted_text;

    // Fallback: If extracted_text was not cached, extract from saved file
    if (!text && doc.file_path && fs.existsSync(doc.file_path)) {
      const buffer = await fs.promises.readFile(doc.file_path);
      text = await extractTextFromPDF(buffer);
      doc.extracted_text = text;
      await doc.save();
    }

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: 'No readable text found in document.' });
    }

    const answer = await askQuestion(text, question);

    res.json({ answer });
  } catch (err) {
    console.error('Ask question error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

/**
 * Reprocess a document — re-generate AI content for a document.
 */
exports.reprocessDocument = async (req, res) => {
  try {
    const { id } = req.params;

    const doc = await Document.findOne({ _id: id, user_id: req.user.id });
    if (!doc) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    console.log('--- REPROCESS START ---');
    console.log('Document:', doc.file_name, 'ID:', doc._id);

    let extractedText = doc.extracted_text;

    if (!extractedText && doc.file_path && fs.existsSync(doc.file_path)) {
      console.log('Extracting text from saved file...');
      const buffer = await fs.promises.readFile(doc.file_path);
      extractedText = await extractTextFromPDF(buffer);
      doc.extracted_text = extractedText;
      await doc.save();
    }

    if (!extractedText || extractedText.trim().length < 50) {
      return res.status(422).json({ error: 'Extracted text is too short.' });
    }
    console.log('Extracted', extractedText.length, 'characters');

    // Delete existing AI content for this document
    console.log('Clearing old AI content...');
    await Promise.all([
      Summary.deleteMany({ document_id: id }),
      Quiz.deleteMany({ document_id: id }),
      Flashcard.deleteMany({ document_id: id }),
    ]);

    // Generate AI content sequentially
    console.log('Generating summary...');
    const summaryText = await generateSummary(extractedText);
    await new Promise((r) => setTimeout(r, 5000));

    console.log('Generating quiz...');
    const quizQuestions = await generateQuiz(extractedText);
    await new Promise((r) => setTimeout(r, 5000));

    console.log('Generating flashcards...');
    const flashcardItems = await generateFlashcards(extractedText);

    // Store results
    console.log('Saving results to MongoDB...');
    await Summary.create({ document_id: id, summary_text: summaryText });

    if (quizQuestions.length > 0) {
      await Quiz.insertMany(
        quizQuestions.map((q) => ({
          document_id: id,
          question: q.question,
          options: q.options,
          correct_answer: q.correct_answer,
        }))
      );
    }

    if (flashcardItems.length > 0) {
      await Flashcard.insertMany(
        flashcardItems.map((f) => ({
          document_id: id,
          question: f.question,
          answer: f.answer,
        }))
      );
    }

    console.log('--- REPROCESS COMPLETE ---');

    res.json({
      message: 'Document reprocessed successfully.',
      summary: summaryText,
      quiz: quizQuestions,
      flashcards: flashcardItems,
    });
  } catch (err) {
    console.error('Reprocess error:', err.message);
    res.status(500).json({ error: 'Failed to reprocess document.', details: err.message });
  }
};

/**
 * Delete a document and all its related content.
 */
exports.deleteDocument = async (req, res) => {
  try {
    const { id } = req.params;

    const doc = await Document.findOne({ _id: id, user_id: req.user.id });
    if (!doc) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    // Delete local file if present
    if (doc.file_path && fs.existsSync(doc.file_path)) {
      try {
        await fs.promises.unlink(doc.file_path);
      } catch (fileErr) {
        console.warn('Could not remove file from disk:', fileErr.message);
      }
    }

    // Delete document and related study content
    await Promise.all([
      Document.deleteOne({ _id: id }),
      Summary.deleteMany({ document_id: id }),
      Quiz.deleteMany({ document_id: id }),
      Flashcard.deleteMany({ document_id: id }),
    ]);

    res.json({ message: 'Document deleted.' });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: 'Failed to delete document.' });
  }
};
