const Joi = require('joi');

const createExam = Joi.object({
    title: Joi.string().required(),
    subject: Joi.string().required(),
    duration: Joi.number().integer().min(1).required(),
    total_marks: Joi.number().integer().min(0).optional(),
    passing_marks: Joi.number().integer().min(0).optional(),
    instructions: Joi.string().allow('', null).optional(),
    target_department: Joi.string().allow('', null).optional(),
    target_year: Joi.string().allow('', null).optional(),
    status: Joi.string().valid('Draft', 'Published').optional(),
    scheduled_start: Joi.date().iso().allow(null).optional(),
    expires_at: Joi.date().iso().required(),
    questions: Joi.array().items(
        Joi.object({
            question: Joi.string().required(),
            options: Joi.array().items(Joi.string().allow('', null)).min(2).required(),
            correct_answer: Joi.number().integer().min(0).required(),
            marks: Joi.number().integer().min(1).optional(),
            difficulty: Joi.string().allow('', null).optional(),
            topic: Joi.string().allow('', null).optional()
        }).custom((value, helpers) => {
            if (value.correct_answer >= value.options.length) {
                return helpers.message(`correct_answer must be less than the number of options (${value.options.length})`);
            }
            return value;
        })
    ).optional()
});

const updateExam = Joi.object({
    title: Joi.string().optional(),
    subject: Joi.string().optional(),
    duration: Joi.number().integer().min(1).optional(),
    passing_marks: Joi.number().integer().min(0).optional(),
    target_department: Joi.string().allow('', null).optional(),
    target_year: Joi.string().allow('', null).optional(),
    status: Joi.string().valid('Draft', 'Published').optional(),
    expires_at: Joi.date().iso().optional(),
    questions: Joi.array().items(
        Joi.object({
            question: Joi.string().required(),
            options: Joi.array().items(Joi.string().allow('', null)).min(2).required(),
            correct_answer: Joi.number().integer().min(0).required(),
            marks: Joi.number().integer().min(1).optional(),
            difficulty: Joi.string().allow('', null).optional(),
            topic: Joi.string().allow('', null).optional()
        }).custom((value, helpers) => {
            if (value.correct_answer >= value.options.length) {
                return helpers.message(`correct_answer must be less than the number of options (${value.options.length})`);
            }
            return value;
        })
    ).optional()
});

const scheduleExam = Joi.object({
    scheduled_start: Joi.date().iso().required(),
    expires_at: Joi.date().iso().greater(Joi.ref('scheduled_start')).required()
});

module.exports = {
    createExam,
    updateExam,
    scheduleExam
};
