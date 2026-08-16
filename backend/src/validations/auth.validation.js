const Joi = require('joi');

const teacherLogin = Joi.object({
    email: Joi.string().email().required().messages({
        'string.email': 'Please provide a valid email address.',
        'any.required': 'Email is required.'
    }),
    password: Joi.string().required().messages({
        'any.required': 'Password is required.'
    })
});

const studentLogin = Joi.object({
    prn_number: Joi.string().required().messages({
        'any.required': 'PRN number is required.'
    }),
    password: Joi.string().required().messages({
        'any.required': 'Password is required.'
    })
});

const changePassword = Joi.object({
    oldPassword: Joi.string().required(),
    newPassword: Joi.string().min(6).required()
});

const createTeacher = Joi.object({
    name: Joi.string().required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required(),
    isMainAdmin: Joi.boolean().optional()
});

const createStudent = Joi.object({
    name: Joi.string().required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required()
});

module.exports = {
    teacherLogin,
    studentLogin,
    changePassword,
    createTeacher,
    createStudent
};
