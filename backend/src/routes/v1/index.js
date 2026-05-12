'use strict';

const express = require('express');
const router  = express.Router();

router.use('/auth',     require('./auth'));
router.use('/reps',     require('./reps'));
router.use('/diets',    require('./diets'));
router.use('/routines', require('./routines'));
router.use('/progress', require('./progress'));
router.use('/habits',   require('./habits'));
router.use('/meals',    require('./meals'));
router.use('/settings', require('./settings'));
router.use('/pdf',      require('./pdf'));
router.use('/yolo',     require('./yolo'));
router.use('/ai',       require('./ai'));
router.use('/n8n',      require('./n8n'));

module.exports = router;
