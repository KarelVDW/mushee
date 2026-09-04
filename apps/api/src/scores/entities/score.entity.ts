import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'

@Entity('scores')
@Index('IDX_scores_userId_updatedAt', ['userId', 'updatedAt'])
@Index('IDX_scores_shareToken', ['shareToken'], { unique: true })
export class Score {
    @PrimaryGeneratedColumn('uuid')
    id: string

    /** References user.id (ON DELETE CASCADE). */
    @Column({ type: 'text' })
    userId: string

    @Column()
    title: string

    @Column({ nullable: true })
    storageKey: string

    /** Secret of the read-only share link (`/s/<token>`); null when the score is not shared. */
    @Column({ type: 'text', nullable: true })
    shareToken: string | null

    @CreateDateColumn({ type: 'timestamptz' })
    createdAt: Date

    @UpdateDateColumn({ type: 'timestamptz' })
    updatedAt: Date
}
