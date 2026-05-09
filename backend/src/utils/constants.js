'use strict';

const ACTIVITY_FACTORS = Object.freeze({
  sedentary:   1.2,
  light:       1.375,
  moderate:    1.55,
  active:      1.725,
  very_active: 1.9,
});

const VALID_GOALS           = Object.freeze(['lose', 'gain', 'maintain']);
const VALID_GENDERS         = Object.freeze(['male', 'female', 'other']);
const VALID_ACTIVITY_LEVELS = Object.freeze(Object.keys(ACTIVITY_FACTORS));
const VALID_ROLES           = Object.freeze(['user', 'assistant']);
const VALID_WORKOUT_TYPES   = Object.freeze(['strength', 'cardio', 'flexibility']);
const VALID_INTENSITIES     = Object.freeze(['low', 'medium', 'high']);
const VALID_EXERCISE_TYPES  = Object.freeze(['pushup', 'squat', 'curl', 'deadlift', 'plank', 'lunge', 'crunch', 'benchpress']);

const CALORIE_TARGETS = Object.freeze({ lose: 1800, gain: 2600, maintain: 2100 });

const BMR_DEFICIT  = 400;
const BMR_SURPLUS  = 300;

module.exports = {
  ACTIVITY_FACTORS,
  VALID_GOALS,
  VALID_GENDERS,
  VALID_ACTIVITY_LEVELS,
  VALID_ROLES,
  VALID_WORKOUT_TYPES,
  VALID_INTENSITIES,
  VALID_EXERCISE_TYPES,
  CALORIE_TARGETS,
  BMR_DEFICIT,
  BMR_SURPLUS,
};
