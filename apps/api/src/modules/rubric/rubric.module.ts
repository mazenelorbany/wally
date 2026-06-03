import { Module } from '@nestjs/common';

import { RubricController } from './rubric.controller';
import { RubricService } from './rubric.service';

@Module({
  controllers: [RubricController],
  providers: [RubricService],
  // Exported so the submission/scoring side can resolve the rubric a photo is
  // graded against without re-querying.
  exports: [RubricService],
})
export class RubricModule {}
