const { task, src, dest } = require('gulp');

task('build:icons', () =>
  src('nodes/**/*.{png,svg}').pipe(dest('dist/nodes')),
);
