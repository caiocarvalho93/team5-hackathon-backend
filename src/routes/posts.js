const express = require('express');
const Post = require('../models/Post');
const Answer = require('../models/Answer');
const User = require('../models/User');
const { authenticate, authorize, checkActivityLimits } = require('../middleware/auth');
const { validate, sanitizeInput, createPostSchema, updatePostSchema, createAnswerSchema } = require('../middleware/validation');
const { asyncHandler, sendSuccess, sendError } = require('../middleware/errorHandler');
const { z } = require('zod');

const router = express.Router();

// Apply authentication to all post routes
router.use(authenticate);
router.use(sanitizeInput);

// @route   GET /api/v1/posts/mine
// @desc    Get current user's posts
// @access  Private
router.get('/mine',
  asyncHandler(async (req, res) => {
    const posts = await Post.find({ authorId: req.userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('authorId', 'profile role');
    
    sendSuccess(res, { posts }, 'Your posts retrieved');
  })
);

// @route   GET /api/v1/posts/feed
// @desc    Get posts feed with filtering
// @access  Private
router.get('/feed',
  asyncHandler(async (req, res) => {
    const { 
      feedType, 
      track, 
      subcategory, 
      limit = 20, 
      page = 1, 
      sort = 'recent',
      search 
    } = req.query;
    
    // Build query
    const query = {};
    
    if (feedType) {
      query.feedType = feedType;
    }
    
    if (track) {
      query.track = track;
    }
    
    if (subcategory) {
      query.subcategory = subcategory;
    }
    
    if (search) {
      query.$or = [
        { title: new RegExp(search, 'i') },
        { content: new RegExp(search, 'i') },
        { tags: { $in: [new RegExp(search, 'i')] } }
      ];
    }
    
    // Check feed permissions
    if (feedType === 'ALUMNI_PROFESSIONAL' && req.user.role === 'STUDENT') {
      return sendError(res, 'Students cannot access Alumni Professional feed', 403, 'ACCESS_DENIED');
    }
    
    // Build sort options
    let sortOptions = {};
    switch (sort) {
      case 'popular':
        sortOptions = { 'analytics.upvotes': -1, 'analytics.views': -1 };
        break;
      case 'answered':
        sortOptions = { 'analytics.answers': -1, createdAt: -1 };
        break;
      case 'unanswered':
        sortOptions = { 'analytics.answers': 1, createdAt: -1 };
        break;
      default:
        sortOptions = { createdAt: -1 };
    }
    
    const skip = (page - 1) * limit;
    
    const [posts, total] = await Promise.all([
      Post.find(query)
        .populate('authorId', 'profile role gamification.level')
        .sort(sortOptions)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Post.countDocuments(query)
    ]);
    
    // Load answers for each post
    const postIds = posts.map(p => p._id);
    const answers = await Answer.find({ postId: { $in: postIds } })
      .populate('authorId', 'profile role')
      .sort({ createdAt: -1 })
      .lean();
    
    // Group answers by post
    const answersByPost = {};
    answers.forEach(a => {
      const key = a.postId.toString();
      if (!answersByPost[key]) answersByPost[key] = [];
      answersByPost[key].push(a);
    });
    
    // Attach answers to posts
    posts.forEach(p => {
      p.answers = answersByPost[p._id.toString()] || [];
    });
    
    sendSuccess(res, {
      posts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    }, 'Posts feed retrieved successfully');
  })
);

// @route   POST /api/v1/posts
// @desc    Create new post
// @access  Private
router.post('/',
  checkActivityLimits,
  validate(createPostSchema),
  asyncHandler(async (req, res) => {
    // Check feed permissions
    if (req.body.feedType === 'ALUMNI_PROFESSIONAL' && req.user.role !== 'ALUMNI' && req.user.role !== 'ADMIN') {
      return sendError(res, 'Only Alumni can post in Professional feed', 403, 'ACCESS_DENIED');
    }
    
    const post = new Post({
      ...req.body,
      authorId: req.userId
    });
    
    await post.save();
    await post.populate('authorId', 'profile role gamification.level');
    
    // Update user activity tracking
    const feedType = req.body.feedType;
    const updateField = feedType === 'QNA' ? 'lastQAPostAt' : 
                      feedType === 'COMMUNITY' ? 'lastCommunityPostAt' : 
                      'lastAlumniPostAt';
    
    await req.user.updateOne({
      [`activityControl.${updateField}`]: new Date(),
      $inc: { 'gamification.totalPosts': 1 }
    });
    
    // Award XP for posting
    await req.user.addXP(5, 'Created post');
    
    sendSuccess(res, { post }, 'Post created successfully', 201);
  })
);

// @route   GET /api/v1/posts/:postId
// @desc    Get single post with answers
// @access  Private
router.get('/:postId',
  asyncHandler(async (req, res) => {
    const { postId } = req.params;
    const { includeAnswers = 'true' } = req.query;
    
    const post = await Post.findById(postId)
      .populate('authorId', 'profile role gamification.level verification.track');
    
    if (!post) {
      return sendError(res, 'Post not found', 404, 'POST_NOT_FOUND');
    }
    
    // Increment view count
    await Post.findByIdAndUpdate(postId, {
      $inc: { 'analytics.views': 1 }
    });
    
    let answers = [];
    if (includeAnswers === 'true') {
      answers = await Answer.find({ postId })
        .populate('authorId', 'profile role gamification.level verification.track')
        .sort({ 'analytics.upvotes': -1, createdAt: -1 });
    }
    
    sendSuccess(res, { 
      post,
      answers: includeAnswers === 'true' ? answers : undefined
    }, 'Post retrieved successfully');
  })
);

// @route   PUT /api/v1/posts/:postId
// @desc    Update post (author only)
// @access  Private
router.put('/:postId',
  validate(updatePostSchema),
  asyncHandler(async (req, res) => {
    const { postId } = req.params;
    
    const post = await Post.findById(postId);
    
    if (!post) {
      return sendError(res, 'Post not found', 404, 'POST_NOT_FOUND');
    }
    
    // Check ownership
    if (!post.authorId.equals(req.userId) && req.user.role !== 'ADMIN') {
      return sendError(res, 'You can only edit your own posts', 403, 'ACCESS_DENIED');
    }
    
    // Update allowed fields
    Object.keys(req.body).forEach(key => {
      if (key !== 'feedType') { // feedType cannot be changed
        post[key] = req.body[key];
      }
    });
    
    post.updatedAt = new Date();
    await post.save();
    
    sendSuccess(res, { post }, 'Post updated successfully');
  })
);

// @route   DELETE /api/v1/posts/:postId
// @desc    Delete post (author or admin only)
// @access  Private
router.delete('/:postId',
  asyncHandler(async (req, res) => {
    const { postId } = req.params;
    
    const post = await Post.findById(postId);
    
    if (!post) {
      return sendError(res, 'Post not found', 404, 'POST_NOT_FOUND');
    }
    
    // Check ownership
    if (!post.authorId.equals(req.userId) && req.user.role !== 'ADMIN') {
      return sendError(res, 'You can only delete your own posts', 403, 'ACCESS_DENIED');
    }
    
    // Delete associated answers
    await Answer.deleteMany({ postId });
    
    // Delete the post
    await Post.findByIdAndDelete(postId);
    
    sendSuccess(res, null, 'Post deleted successfully');
  })
);

// @route   POST /api/v1/posts/:postId/upvote
// @desc    Upvote a post
// @access  Private
router.post('/:postId/upvote',
  asyncHandler(async (req, res) => {
    const { postId } = req.params;
    
    const post = await Post.findById(postId);
    
    if (!post) {
      return sendError(res, 'Post not found', 404, 'POST_NOT_FOUND');
    }
    
    // Check if user already upvoted
    const hasUpvoted = post.analytics.upvotedBy.includes(req.userId);
    
    if (hasUpvoted) {
      // Remove upvote
      post.analytics.upvotedBy.pull(req.userId);
      post.analytics.upvotes = Math.max(0, post.analytics.upvotes - 1);
    } else {
      // Add upvote
      post.analytics.upvotedBy.push(req.userId);
      post.analytics.upvotes += 1;
      
      // Award XP to post author (but not if upvoting own post)
      if (!post.authorId.equals(req.userId)) {
        const author = await User.findById(post.authorId);
        if (author) {
          await author.addXP(2, 'Post upvoted');
        }
      }
    }
    
    await post.save();
    
    sendSuccess(res, { 
      upvotes: post.analytics.upvotes,
      hasUpvoted: !hasUpvoted
    }, hasUpvoted ? 'Upvote removed' : 'Post upvoted');
  })
);

// @route   POST /api/v1/posts/:postId/answers
// @desc    Add answer to post
// @access  Private (Alumni only for Q&A posts)
router.post('/:postId/answers',
  validate(createAnswerSchema),
  asyncHandler(async (req, res) => {
    const { postId } = req.params;
    
    const post = await Post.findById(postId);
    
    if (!post) {
      return sendError(res, 'Post not found', 404, 'POST_NOT_FOUND');
    }
    
    // Check if Alumni can answer Q&A posts
    if (post.feedType === 'QNA' && req.user.role === 'STUDENT') {
      return sendError(res, 'Only Alumni can answer Q&A posts', 403, 'ACCESS_DENIED');
    }
    
    // Check if Alumni is approved for Q&A answers
    if (post.feedType === 'QNA' && req.user.role === 'ALUMNI' && req.user.tutorStatus !== 'APPROVED') {
      return sendError(res, 'Only approved Alumni can answer Q&A posts', 403, 'APPROVAL_REQUIRED');
    }
    
    const answer = new Answer({
      postId,
      authorId: req.userId,
      ...req.body
    });
    
    await answer.save();
    await answer.populate('authorId', 'profile role gamification.level verification.track');
    
    // Update post answer count
    await Post.findByIdAndUpdate(postId, {
      $inc: { 'analytics.answers': 1 }
    });
    
    // Update user stats and award XP
    await req.user.updateOne({
      $inc: { 'gamification.totalAnswers': 1 }
    });
    
    await req.user.addXP(10, 'Answered question');
    
    sendSuccess(res, { answer }, 'Answer added successfully', 201);
  })
);

// @route   GET /api/v1/posts/:postId/answers
// @desc    Get answers for a post
// @access  Private
router.get('/:postId/answers',
  asyncHandler(async (req, res) => {
    const { postId } = req.params;
    const { limit = 20, page = 1, sort = 'popular' } = req.query;
    
    const post = await Post.findById(postId);
    
    if (!post) {
      return sendError(res, 'Post not found', 404, 'POST_NOT_FOUND');
    }
    
    let sortOptions = {};
    switch (sort) {
      case 'recent':
        sortOptions = { createdAt: -1 };
        break;
      case 'oldest':
        sortOptions = { createdAt: 1 };
        break;
      default:
        sortOptions = { 'analytics.upvotes': -1, createdAt: -1 };
    }
    
    const skip = (page - 1) * limit;
    
    const [answers, total] = await Promise.all([
      Answer.find({ postId })
        .populate('authorId', 'profile role gamification.level verification.track')
        .sort(sortOptions)
        .skip(skip)
        .limit(parseInt(limit)),
      Answer.countDocuments({ postId })
    ]);
    
    sendSuccess(res, {
      answers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    }, 'Answers retrieved successfully');
  })
);

// @route   POST /api/v1/posts/answers/:answerId/upvote
// @desc    Upvote an answer
// @access  Private
router.post('/answers/:answerId/upvote',
  asyncHandler(async (req, res) => {
    const { answerId } = req.params;
    
    const answer = await Answer.findById(answerId);
    
    if (!answer) {
      return sendError(res, 'Answer not found', 404, 'ANSWER_NOT_FOUND');
    }
    
    // Check if user already upvoted
    const hasUpvoted = answer.analytics.upvotedBy.includes(req.userId);
    
    if (hasUpvoted) {
      // Remove upvote
      answer.analytics.upvotedBy.pull(req.userId);
      answer.analytics.upvotes = Math.max(0, answer.analytics.upvotes - 1);
    } else {
      // Add upvote
      answer.analytics.upvotedBy.push(req.userId);
      answer.analytics.upvotes += 1;
      
      // Award XP to answer author (but not if upvoting own answer)
      if (!answer.authorId.equals(req.userId)) {
        const author = await User.findById(answer.authorId);
        if (author) {
          await author.addXP(3, 'Answer upvoted');
        }
      }
    }
    
    await answer.save();
    
    sendSuccess(res, { 
      upvotes: answer.analytics.upvotes,
      hasUpvoted: !hasUpvoted
    }, hasUpvoted ? 'Upvote removed' : 'Answer upvoted');
  })
);

// @route   POST /api/v1/posts/answers/:answerId/helpful
// @desc    Mark answer as helpful
// @access  Private
router.post('/answers/:answerId/helpful',
  asyncHandler(async (req, res) => {
    const { answerId } = req.params;
    
    const answer = await Answer.findById(answerId)
      .populate('postId', 'authorId');
    
    if (!answer) {
      return sendError(res, 'Answer not found', 404, 'ANSWER_NOT_FOUND');
    }
    
    // Only post author can mark answers as helpful
    if (!answer.postId.authorId.equals(req.userId)) {
      return sendError(res, 'Only the question author can mark answers as helpful', 403, 'ACCESS_DENIED');
    }
    
    // Check if already marked as helpful
    const hasMarked = answer.analytics.helpfulMarkedBy.includes(req.userId);
    
    if (hasMarked) {
      return sendError(res, 'Already marked as helpful', 400, 'ALREADY_MARKED');
    }
    
    // Mark as helpful
    answer.analytics.helpfulMarkedBy.push(req.userId);
    answer.analytics.helpfulMarks += 1;
    await answer.save();
    
    // Award bonus XP to answer author
    const author = await User.findById(answer.authorId);
    if (author) {
      await author.addXP(5, 'Answer marked as helpful');
    }
    
    sendSuccess(res, { 
      helpfulMarks: answer.analytics.helpfulMarks
    }, 'Answer marked as helpful');
  })
);

module.exports = router;